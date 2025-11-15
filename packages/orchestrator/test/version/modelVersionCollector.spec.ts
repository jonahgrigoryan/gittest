import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ModelVersionCollector } from "../../src/version/collector";

describe("ModelVersionCollector", () => {
  let tempDir: string | null = null;

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("collects version metadata and caches results", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "versions-"));
    const cacheDir = path.join(tempDir, "cache");
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      path.join(cacheDir, "cache_manifest.json"),
      JSON.stringify({ version: "1.0.0", fingerprint: "sha256-v1" })
    );

    const layoutPath = path.join(tempDir, "layout.json");
    await writeFile(layoutPath, JSON.stringify({ layout: "demo" }));

    const configStub = {
      get: (key: string) => {
        if (key === "agents.models") {
          return [
            { name: "agentA", provider: "openai", modelId: "gpt-4.1", persona: "gto", promptTemplate: "" }
          ];
        }
        return undefined;
      }
    };

    const collector = new ModelVersionCollector({
      configManager: configStub,
      cachePath: cacheDir,
      layoutPath,
      cacheTTLMs: 1000,
      logger: console
    });

    const first = await collector.collect();
    expect(first.llm?.agentA?.modelId).toBe("gpt-4.1");
    expect(first.vision?.modelFiles).toContain("layout.json");
    expect(first.gtoCache?.manifestVersion).toBe("1.0.0");

    const cached = await collector.collect();
    expect(cached).toBe(first);

    await collector.refresh();
    const refreshed = await collector.collect();
    expect(refreshed).not.toBe(first);
  });
});
