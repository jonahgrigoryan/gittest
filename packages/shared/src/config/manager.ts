import fs from "fs";
import path from "path";
import type { BotConfig, ValidationResult } from "./types";
import { validateConfig } from "./loader";
import type { FSWatcher } from "chokidar";

const defaultSchemaPath = path.resolve(__dirname, "../../../../config/schema/bot-config.schema.json");

/**
 * ConfigurationManager handles configuration loading, validation, hot-reload, and subscriptions.
 * Use the factory function createConfigManager() to instantiate.
 */
export class ConfigurationManager {
  private config: BotConfig | null = null;
  private lastValidConfig: BotConfig | null = null;
  private watcher: FSWatcher | null = null;
  private subscribers: Map<string, Set<(value: unknown) => void>> = new Map();
  private configPath: string | null = null;
  private pendingReload: Promise<void> | null = null;
  private schemaPath: string;

  constructor(schemaPath: string = defaultSchemaPath) {
    this.schemaPath = schemaPath;
  }

  /**
   * Load configuration from file and validate it.
   * @param configPath - Path to configuration JSON file
   * @returns Loaded and validated configuration
   */
  async load(configPath: string): Promise<BotConfig> {
    const raw = fs.readFileSync(configPath, "utf-8");
    const cfg = JSON.parse(raw) as unknown;
    
    const result = this.validate(cfg);
    if (!result.valid) {
      throw new Error(`Config validation failed:\n${result.errors?.join("\n")}`);
    }

    this.config = cfg as BotConfig;
    this.lastValidConfig = cfg as BotConfig;
    this.configPath = configPath;
    
    // Notify subscribers on initial load (pass null as oldConfig)
    this.detectAndNotifyChanges(this.config, null);

    return this.config;
  }

  /**
   * Validate configuration object against schema.
   * @param config - Configuration object to validate
   * @returns ValidationResult with valid flag and optional errors
   */
  validate(config: unknown): ValidationResult {
    return validateConfig(config, this.schemaPath);
  }

  /**
   * Hot-reload configuration from file with validation and rollback on failure.
   * Concurrent calls are serialized to prevent race conditions.
   * @param configPath - Optional path to config file (defaults to last loaded path)
   */
  async hotReload(configPath?: string): Promise<void> {
    // Serialize concurrent reloads
    if (this.pendingReload) {
      await this.pendingReload;
    }

    const reloadPath = configPath || this.configPath;
    if (!reloadPath) {
      throw new Error("No config path available for hot-reload");
    }

    this.pendingReload = this._performReload(reloadPath);
    try {
      await this.pendingReload;
    } finally {
      this.pendingReload = null;
    }
  }

  private async _performReload(configPath: string): Promise<void> {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const cfg = JSON.parse(raw) as unknown;
      
      const result = this.validate(cfg);
      if (!result.valid) {
        console.error(`Hot-reload validation failed for ${configPath}:`, result.errors);
        throw new Error(`Config validation failed:\n${result.errors?.join("\n")}`);
      }

      const newConfig = cfg as BotConfig;
      const previousConfig = this.lastValidConfig;
      
      // Update config first so subscribers can read new values via get()
      this.config = newConfig;
      this.lastValidConfig = newConfig;
      this.configPath = configPath;
      
      // Detect changes and notify affected subscribers using previousConfig for comparison
      this.detectAndNotifyChanges(newConfig, previousConfig);

    } catch (error) {
      console.error(`Hot-reload failed for ${configPath}:`, error);
      // Rollback to lastValidConfig
      if (this.lastValidConfig) {
        this.config = this.lastValidConfig;
        // No need to notify on rollback - values haven't changed from lastValid
      }
      throw error;
    }
  }

  /**
   * Get configuration value at specified key path.
   * Supports dot notation (e.g., "vision.confidenceThreshold").
   * @param keyPath - Dot-separated path to config value
   * @returns Value at specified path
   */
  get<T>(keyPath: string): T {
    if (!this.config) {
      throw new Error("Config not loaded");
    }

    const pathParts = this.parseKeyPath(keyPath);
    return this.getValueAtPath(this.config, pathParts) as T;
  }

  /**
   * Subscribe to configuration changes at specified key path.
   * Callback fires whenever the value at keyPath changes during hot-reload.
   * @param keyPath - Dot-separated path to config value
   * @param callback - Function to call when value changes
   */
  subscribe(keyPath: string, callback: (value: unknown) => void): void {
    if (!this.subscribers.has(keyPath)) {
      this.subscribers.set(keyPath, new Set());
    }
    this.subscribers.get(keyPath)!.add(callback);
  }

  /**
   * Start watching configuration file for changes.
   * Triggers hot-reload on file modification with 100ms debouncing.
   * @param configPath - Optional path to watch (defaults to last loaded path)
   */
  async startWatching(configPath?: string): Promise<void> {
    const watchPath = configPath || this.configPath;
    if (!watchPath) {
      throw new Error("No config path available for watching");
    }

    if (this.watcher) {
      await this.stopWatching();
    }

    const chokidar = await import("chokidar");
    this.watcher = chokidar.watch(watchPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });

    this.watcher.on("change", async () => {
      try {
        await this.hotReload(watchPath);
      } catch (error) {
        console.error("File watch hot-reload failed:", error);
      }
    });

    this.watcher.on("unlink", () => {
      console.error(`Config file deleted: ${watchPath}`);
    });

    this.watcher.on("error", (error: unknown) => {
      console.error(`File watcher error for ${watchPath}:`, error);
    });
  }

  /**
   * Stop watching configuration file.
   */
  async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Detect changes between old and new config and notify affected subscribers.
   * Only notifies subscribers whose subscribed values have actually changed.
   * @param newConfig - New configuration to compare
   * @param oldConfig - Old configuration to compare against (null on first load)
   */
  private detectAndNotifyChanges(newConfig: BotConfig, oldConfig: BotConfig | null): void {
    for (const [keyPath] of this.subscribers) {
      try {
        const pathParts = this.parseKeyPath(keyPath);
        const newValue = this.getValueAtPath(newConfig, pathParts);
        
        if (oldConfig === null) {
          // First load - notify all subscribers
          this.notifySubscribers(keyPath, newValue);
        } else {
          const oldValue = this.getValueAtPath(oldConfig, pathParts);
          // Only notify if values actually changed
          if (JSON.stringify(newValue) !== JSON.stringify(oldValue)) {
            this.notifySubscribers(keyPath, newValue);
          }
        }
      } catch (error) {
        console.error(`Failed to detect changes for ${keyPath}:`, error);
      }
    }
  }

  /**
   * Notify subscribers for a specific key path.
   * @param keyPath - Key path that changed
   * @param value - New value at key path
   */
  private notifySubscribers(keyPath: string, value: unknown): void {
    const callbacks = this.subscribers.get(keyPath);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(value);
        } catch (error) {
          console.error(`Subscriber callback failed for ${keyPath}:`, error);
        }
      }
    }
  }

  /**
   * Parse key path into array of keys.
   * @param keyPath - Dot-separated path string
   * @returns Array of path parts
   */
  private parseKeyPath(keyPath: string): string[] {
    return keyPath.split(".");
  }

  /**
   * Get value at specified path in configuration object.
   * @param config - Configuration object
   * @param pathParts - Array of path parts
   * @returns Value at specified path
   */
  private getValueAtPath(config: BotConfig, pathParts: string[]): unknown {
    let current: unknown = config;
    
    for (const part of pathParts) {
      if (current === null || current === undefined) {
        throw new Error(`Invalid path: cannot access property '${part}' of ${current}`);
      }
      if (typeof current !== "object") {
        throw new Error(`Invalid path: '${part}' is not an object property`);
      }
      // Type assertion after narrowing to object
      const obj = current as Record<string, unknown>;
      if (!(part in obj)) {
        throw new Error(`Invalid path: property '${part}' does not exist`);
      }
      current = obj[part];
    }
    
    return current;
  }
}

/**
 * Factory function to create a ConfigurationManager instance.
 * @param configPath - Path to configuration file to load immediately
 * @param schemaPath - Optional path to JSON schema file
 * @returns Initialized ConfigurationManager instance
 */
export async function createConfigManager(
  configPath: string,
  schemaPath?: string
): Promise<ConfigurationManager> {
  const manager = new ConfigurationManager(schemaPath);
  await manager.load(configPath);
  return manager;
}
