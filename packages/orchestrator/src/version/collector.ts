import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ModelVersions } from "@poker-bot/shared/src/strategy";
import type { ConfigurationManager } from "@poker-bot/shared/src/config/manager";
import type { AgentModelConfig } from "@poker-bot/shared/src/config/types";

const CACHE_MANIFEST = "cache_manifest.json";

export interface ModelVersionCollectorOptions {
  configManager: Pick<ConfigurationManager, "get">;
  cachePath: string;
  layoutPath?: string;
  cacheTTLMs?: number;
  logger?: Pick<Console, "debug" | "info" | "warn" | "error">;
}

export class ModelVersionCollector {
  private cached: ModelVersions | null = null;
  private lastCollected = 0;

  constructor(private readonly options: ModelVersionCollectorOptions) {}

  async collect(): Promise<ModelVersions> {
    const ttl = this.options.cacheTTLMs ?? 0;
    const now = Date.now();
    if (ttl > 0 && this.cached && now - this.lastCollected < ttl) {
      return this.cached;
    }

    const [llm, vision, gtoCache] = await Promise.all([
      this.collectLLMVersions(),
      this.collectVisionVersions(),
      this.collectGtoCacheVersion()
    ]);

    const versions: ModelVersions = {
      llm: llm ?? undefined,
      vision: vision ?? undefined,
      gtoCache: gtoCache ?? undefined
    };

    this.cached = versions;
    this.lastCollected = now;
    return versions;
  }

  async refresh(): Promise<ModelVersions> {
    this.cached = null;
    this.lastCollected = 0;
    return this.collect();
  }

  private async collectLLMVersions(): Promise<ModelVersions["llm"] | null> {
    let configs: AgentModelConfig[] | undefined;
    try {
      configs = this.options.configManager.get<AgentModelConfig[] | undefined>("agents.models");
    } catch (error) {
      this.options.logger?.warn?.("ModelVersionCollector: failed to read agents.models", {
        error: error instanceof Error ? error.message : error
      });
      return null;
    }
    if (!configs || configs.length === 0) {
      return null;
    }
    const versions: NonNullable<ModelVersions["llm"]> = {};
    for (const config of configs) {
      versions[config.name] = {
        modelId: config.modelId,
        provider: config.provider,
        version: config.modelId
      };
    }
    return versions;
  }

  private async collectVisionVersions(): Promise<ModelVersions["vision"] | null> {
    const layoutPath = this.options.layoutPath;
    if (!layoutPath) {
      return null;
    }
    const fileName = path.basename(layoutPath);
    const dir = path.dirname(layoutPath);
    try {
      const contents = await readFile(layoutPath);
      const hash = createHash("sha256").update(contents).digest("hex");
      return {
        modelFiles: [fileName],
        versions: { [fileName]: hash },
        modelDir: dir
      };
    } catch (error) {
      this.options.logger?.warn?.("ModelVersionCollector: failed to read vision layout pack", {
        path: layoutPath,
        error: error instanceof Error ? error.message : error
      });
      return {
        modelFiles: [],
        versions: {},
        modelDir: dir
      };
    }
  }

  private async collectGtoCacheVersion(): Promise<ModelVersions["gtoCache"] | null> {
    const manifestPath = path.join(this.options.cachePath, CACHE_MANIFEST);
    try {
      const raw = await readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(raw) as {
        version?: string;
        fingerprint?: string;
      };
      return {
        manifestVersion: manifest.version ?? "unknown",
        fingerprintAlgorithm: manifest.fingerprint ?? "unknown",
        cachePath: this.options.cachePath
      };
    } catch (error) {
      this.options.logger?.warn?.("ModelVersionCollector: cache manifest missing", {
        path: manifestPath,
        error: error instanceof Error ? error.message : error
      });
      return {
        manifestVersion: "unknown",
        fingerprintAlgorithm: "unknown",
        cachePath: this.options.cachePath
      };
    }
  }
}
