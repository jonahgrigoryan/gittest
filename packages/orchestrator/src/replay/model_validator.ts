import type { ModelVersions } from "@poker-bot/shared";
import type { ModelVersionCollector } from "../version/collector";

export interface ModelVersionMismatch {
  component: "llm" | "vision" | "gtoCache";
  agentId?: string;
  field: string;
  logged?: string;
  current?: string;
}

interface ValidatorOptions {
  strict?: boolean;
  logger?: Pick<Console, "debug" | "info" | "warn" | "error">;
}

export class ModelVersionValidator {
  private readonly strict: boolean;
  private readonly logger?: Pick<Console, "debug" | "info" | "warn" | "error">;

  constructor(private readonly collector: ModelVersionCollector, options: ValidatorOptions = {}) {
    this.strict = options.strict ?? false;
    this.logger = options.logger;
  }

  async validate(logged: ModelVersions | undefined): Promise<{
    matches: boolean;
    mismatches: ModelVersionMismatch[];
    warnings: string[];
    current: ModelVersions;
  }> {
    const current = await this.collector.collect();
    const mismatches: ModelVersionMismatch[] = [];

    if (logged?.llm) {
      for (const [agentId, loggedInfo] of Object.entries(logged.llm)) {
        const currentInfo = current.llm?.[agentId];
        if (!currentInfo) {
          mismatches.push({
            component: "llm",
            agentId,
            field: "modelId",
            logged: loggedInfo.modelId,
            current: undefined
          });
          continue;
        }
        if (loggedInfo.modelId !== currentInfo.modelId) {
          mismatches.push({
            component: "llm",
            agentId,
            field: "modelId",
            logged: loggedInfo.modelId,
            current: currentInfo.modelId
          });
        }
        if (loggedInfo.weightsHash && loggedInfo.weightsHash !== currentInfo.weightsHash) {
          mismatches.push({
            component: "llm",
            agentId,
            field: "weightsHash",
            logged: loggedInfo.weightsHash,
            current: currentInfo.weightsHash
          });
        }
      }
    }

    if (logged?.vision) {
      const loggedFiles = [...(logged.vision.modelFiles ?? [])].sort();
      const currentFiles = [...(current.vision?.modelFiles ?? [])].sort();
      if (JSON.stringify(loggedFiles) !== JSON.stringify(currentFiles)) {
        mismatches.push({
          component: "vision",
          field: "modelFiles",
          logged: loggedFiles.join(","),
          current: currentFiles.join(",")
        });
      }
      const loggedVersions = logged.vision.versions ?? {};
      for (const [file, version] of Object.entries(loggedVersions)) {
        const currentVersion = current.vision?.versions?.[file];
        if (version !== currentVersion) {
          mismatches.push({
            component: "vision",
            field: `versions.${file}`,
            logged: version,
            current: currentVersion
          });
        }
      }
      if (logged.vision.modelDir && logged.vision.modelDir !== current.vision?.modelDir) {
        mismatches.push({
          component: "vision",
          field: "modelDir",
          logged: logged.vision.modelDir,
          current: current.vision?.modelDir
        });
      }
    }

    if (logged?.gtoCache) {
      if (logged.gtoCache.manifestVersion !== current.gtoCache?.manifestVersion) {
        mismatches.push({
          component: "gtoCache",
          field: "manifestVersion",
          logged: logged.gtoCache.manifestVersion,
          current: current.gtoCache?.manifestVersion
        });
      }
      if (logged.gtoCache.fingerprintAlgorithm !== current.gtoCache?.fingerprintAlgorithm) {
        mismatches.push({
          component: "gtoCache",
          field: "fingerprintAlgorithm",
          logged: logged.gtoCache.fingerprintAlgorithm,
          current: current.gtoCache?.fingerprintAlgorithm
        });
      }
      if (logged.gtoCache.cachePath && logged.gtoCache.cachePath !== current.gtoCache?.cachePath) {
        mismatches.push({
          component: "gtoCache",
          field: "cachePath",
          logged: logged.gtoCache.cachePath,
          current: current.gtoCache?.cachePath
        });
      }
    }

    const warnings = mismatches.map(mismatch => {
      const agentPart = mismatch.agentId ? ` agent ${mismatch.agentId}` : "";
      return `${mismatch.component}${agentPart} ${mismatch.field} mismatch: logged=${mismatch.logged ?? "unknown"} current=${mismatch.current ?? "unknown"}`;
    });

    if (mismatches.length > 0) {
      warnings.forEach(message => this.logger?.warn?.(`Model version mismatch: ${message}`));
      if (this.strict) {
        throw new Error(`Model versions do not match logged data (${mismatches.length} differences).`);
      }
    }

    return {
      matches: mismatches.length === 0,
      mismatches,
      warnings,
      current
    };
  }
}
