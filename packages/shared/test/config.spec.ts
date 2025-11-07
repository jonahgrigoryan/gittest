import { describe, it, expect, afterEach, beforeEach } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import { loadConfig, validateConfig } from "../src/config/loader";
import { ConfigurationManager, createConfigManager } from "../src/config/manager";
import type { BotConfig } from "../src/config/types";

describe("config loader", () => {
  it("loads and validates default config", () => {
    const cfgPath = path.resolve(__dirname, "../../../config/bot/default.bot.json");
    const cfg = loadConfig(cfgPath);
    expect(cfg).toBeTruthy();
    expect(cfg).toHaveProperty("vision");
  });
});

describe("ConfigurationManager", () => {
  const defaultConfigPath = path.resolve(__dirname, "../../../config/bot/default.bot.json");
  const schemaPath = path.resolve(__dirname, "../../../config/schema/bot-config.schema.json");
  let tempDir: string;
  let tempConfigPath: string;
  let manager: ConfigurationManager | null = null;

  beforeEach(async () => {
    // Create temp directory for test configs
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "config-test-"));
    tempConfigPath = path.join(tempDir, "test-config.json");
    
    // Copy default config to temp location
    const defaultConfig = await fs.promises.readFile(defaultConfigPath, "utf-8");
    await fs.promises.writeFile(tempConfigPath, defaultConfig, "utf-8");
  });

  afterEach(async () => {
    // Stop watching and cleanup
    if (manager) {
      await manager.stopWatching();
      manager = null;
    }
    
    // Remove temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("Basic loading and validation", () => {
    it("loads valid config successfully", async () => {
      manager = new ConfigurationManager(schemaPath);
      const cfg = await manager.load(tempConfigPath);
      expect(cfg).toBeTruthy();
      expect(cfg).toHaveProperty("vision");
      expect(cfg).toHaveProperty("compliance");
    });

    it("throws error on invalid config", async () => {
      const invalidConfigPath = path.join(tempDir, "invalid.json");
      await fs.promises.writeFile(invalidConfigPath, JSON.stringify({ invalid: "config" }), "utf-8");
      
      manager = new ConfigurationManager(schemaPath);
      await expect(manager.load(invalidConfigPath)).rejects.toThrow("Config validation failed");
    });

    it("validateConfig returns correct ValidationResult", () => {
      const validConfig = JSON.parse(fs.readFileSync(defaultConfigPath, "utf-8"));
      const result = validateConfig(validConfig, schemaPath);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("validateConfig returns errors for invalid config", () => {
      const invalidConfig = { invalid: "config" };
      const result = validateConfig(invalidConfig, schemaPath);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });
  });

  describe("get<T> method", () => {
    beforeEach(async () => {
      manager = await createConfigManager(tempConfigPath, schemaPath);
    });

    it("gets top-level property", () => {
      const vision = manager!.get<{ layoutPack: string }>("vision");
      expect(vision).toBeTruthy();
      expect(vision).toHaveProperty("layoutPack");
    });

    it("gets nested property with dot notation", () => {
      const threshold = manager!.get<number>("vision.confidenceThreshold");
      expect(typeof threshold).toBe("number");
      expect(threshold).toBe(0.9);
    });

    it("retrieves agent cost policy", () => {
      const maxTokens = manager!.get<number>("agents.costPolicy.maxTokensDecision");
      expect(maxTokens).toBeGreaterThan(0);
    });

    it("gets deeply nested property", () => {
      const small = manager!.get<number>("compliance.blinds.small");
      expect(typeof small).toBe("number");
    });

    it("throws error on invalid path", () => {
      expect(() => manager!.get("nonexistent")).toThrow("does not exist");
    });

    it("throws error on invalid nested path", () => {
      expect(() => manager!.get("vision.nonexistent")).toThrow("does not exist");
    });
  });

  describe("Hot-reload", () => {
    beforeEach(async () => {
      manager = await createConfigManager(tempConfigPath, schemaPath);
    });

    it("hot-reloads with valid config", async () => {
      const originalThreshold = manager!.get<number>("vision.confidenceThreshold");
      
      // Modify config
      const config = JSON.parse(await fs.promises.readFile(tempConfigPath, "utf-8")) as BotConfig;
      config.vision.confidenceThreshold = 0.99;
      await fs.promises.writeFile(tempConfigPath, JSON.stringify(config, null, 2), "utf-8");
      
      // Hot reload
      await manager!.hotReload();
      
      const newThreshold = manager!.get<number>("vision.confidenceThreshold");
      expect(newThreshold).toBe(0.99);
      expect(newThreshold).not.toBe(originalThreshold);
    });

    it("rolls back on invalid config", async () => {
      const originalThreshold = manager!.get<number>("vision.confidenceThreshold");
      
      // Write invalid config
      await fs.promises.writeFile(tempConfigPath, JSON.stringify({ invalid: "config" }), "utf-8");
      
      // Hot reload should fail and rollback
      await expect(manager!.hotReload()).rejects.toThrow("Config validation failed");
      
      // Verify rollback preserved old value
      const currentThreshold = manager!.get<number>("vision.confidenceThreshold");
      expect(currentThreshold).toBe(originalThreshold);
    });

    it("hotReload defaults to last loaded path", async () => {
      const config = JSON.parse(await fs.promises.readFile(tempConfigPath, "utf-8")) as BotConfig;
      config.vision.confidenceThreshold = 0.98;
      await fs.promises.writeFile(tempConfigPath, JSON.stringify(config, null, 2), "utf-8");
      
      // Call without path argument
      await manager!.hotReload();
      
      expect(manager!.get<number>("vision.confidenceThreshold")).toBe(0.98);
    });

    it("serializes concurrent reloads", async () => {
      const config = JSON.parse(await fs.promises.readFile(tempConfigPath, "utf-8")) as BotConfig;
      config.vision.confidenceThreshold = 0.97;
      await fs.promises.writeFile(tempConfigPath, JSON.stringify(config, null, 2), "utf-8");
      
      // Start multiple reloads concurrently
      const reload1 = manager!.hotReload();
      const reload2 = manager!.hotReload();
      const reload3 = manager!.hotReload();
      
      await Promise.all([reload1, reload2, reload3]);
      
      // Should complete without errors and have final value
      expect(manager!.get<number>("vision.confidenceThreshold")).toBe(0.97);
    });
  });

  describe("File watching", () => {
    beforeEach(async () => {
      manager = await createConfigManager(tempConfigPath, schemaPath);
    });

    it("triggers reload on file change", async () => {
      await manager!.startWatching();
      
      const originalThreshold = manager!.get<number>("vision.confidenceThreshold");
      
      // Modify config file
      const config = JSON.parse(await fs.promises.readFile(tempConfigPath, "utf-8")) as BotConfig;
      config.vision.confidenceThreshold = 0.96;
      await fs.promises.writeFile(tempConfigPath, JSON.stringify(config, null, 2), "utf-8");
      
      // Wait for debounce and reload
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const newThreshold = manager!.get<number>("vision.confidenceThreshold");
      expect(newThreshold).toBe(0.96);
      expect(newThreshold).not.toBe(originalThreshold);
    });

    it("stops watching when requested", async () => {
      await manager!.startWatching();
      await manager!.stopWatching();
      
      // Modify config
      const config = JSON.parse(await fs.promises.readFile(tempConfigPath, "utf-8")) as BotConfig;
      config.vision.confidenceThreshold = 0.95;
      await fs.promises.writeFile(tempConfigPath, JSON.stringify(config, null, 2), "utf-8");
      
      // Wait to ensure no reload happens
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Value should not change
      expect(manager!.get<number>("vision.confidenceThreshold")).toBe(0.9);
    });
  });

  describe("Subscription system", () => {
    beforeEach(async () => {
      manager = await createConfigManager(tempConfigPath, schemaPath);
    });

    it("notifies subscriber on config change", async () => {
      let callbackValue: number | null = null;
      
      manager!.subscribe("vision.confidenceThreshold", (value) => {
        callbackValue = value;
      });
      
      // Modify and reload
      const config = JSON.parse(await fs.promises.readFile(tempConfigPath, "utf-8")) as BotConfig;
      config.vision.confidenceThreshold = 0.94;
      await fs.promises.writeFile(tempConfigPath, JSON.stringify(config, null, 2), "utf-8");
      await manager!.hotReload();
      
      expect(callbackValue).toBe(0.94);
    });

    it("notifies multiple subscribers", async () => {
      let callback1Value: number | null = null;
      let callback2Value: number | null = null;
      
      manager!.subscribe("vision.confidenceThreshold", (value) => {
        callback1Value = value;
      });
      
      manager!.subscribe("vision.confidenceThreshold", (value) => {
        callback2Value = value;
      });
      
      // Modify and reload
      const config = JSON.parse(await fs.promises.readFile(tempConfigPath, "utf-8")) as BotConfig;
      config.vision.confidenceThreshold = 0.93;
      await fs.promises.writeFile(tempConfigPath, JSON.stringify(config, null, 2), "utf-8");
      await manager!.hotReload();
      
      expect(callback1Value).toBe(0.93);
      expect(callback2Value).toBe(0.93);
    });

    it("does not notify subscribers for unrelated changes", async () => {
      let visionCallbackCalled = false;
      
      manager!.subscribe("vision.confidenceThreshold", () => {
        visionCallbackCalled = true;
      });
      
      // Modify different property (not vision.confidenceThreshold)
      const config = JSON.parse(await fs.promises.readFile(tempConfigPath, "utf-8")) as BotConfig;
      config.strategy.alphaGTO = 0.8;
      await fs.promises.writeFile(tempConfigPath, JSON.stringify(config, null, 2), "utf-8");
      await manager!.hotReload();
      
      // Vision callback should NOT fire because vision.confidenceThreshold didn't change
      expect(visionCallbackCalled).toBe(false);
      expect(manager!.get<number>("vision.confidenceThreshold")).toBe(0.9);
    });
  });

  describe("Integration scenarios", () => {
    beforeEach(async () => {
      manager = await createConfigManager(tempConfigPath, schemaPath);
    });

    it("full workflow: load → subscribe → hot-reload → verify", async () => {
      let subscriberValue: number | null = null;
      
      // Subscribe
      manager!.subscribe("strategy.alphaGTO", (value) => {
        subscriberValue = value;
      });
      
      const originalValue = manager!.get<number>("strategy.alphaGTO");
      
      // Modify and reload
      const config = JSON.parse(await fs.promises.readFile(tempConfigPath, "utf-8")) as BotConfig;
      config.strategy.alphaGTO = 0.75;
      await fs.promises.writeFile(tempConfigPath, JSON.stringify(config, null, 2), "utf-8");
      await manager!.hotReload();
      
      // Verify all changes propagated
      expect(subscriberValue).toBe(0.75);
      expect(manager!.get<number>("strategy.alphaGTO")).toBe(0.75);
      expect(manager!.get<number>("strategy.alphaGTO")).not.toBe(originalValue);
    });

    it("rollback scenario: config remains unchanged after failed reload", async () => {
      const originalValue = manager!.get<number>("strategy.alphaGTO");
      
      // Write invalid config
      await fs.promises.writeFile(tempConfigPath, JSON.stringify({ invalid: "config" }), "utf-8");
      
      // Attempt reload (should fail)
      await expect(manager!.hotReload()).rejects.toThrow();
      
      // Config should remain at original value (rollback)
      expect(manager!.get<number>("strategy.alphaGTO")).toBe(originalValue);
    });
  });
});
