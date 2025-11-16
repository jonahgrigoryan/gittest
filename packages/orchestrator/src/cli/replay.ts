#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createConfigManager } from "@poker-bot/shared";
import type { config as sharedConfig } from "@poker-bot/shared";
import { CacheLoader } from "../solver";
import { GTOSolver } from "../solver/solver";
import { createSolverClient } from "../solver_client/client";
import { StrategyEngine } from "../strategy/engine";
import { TimeBudgetTracker } from "../budget/timeBudgetTracker";
import type { RiskGuardAPI, RiskSnapshot } from "../safety/types";
import { ReplayEngine } from "../replay/engine";
import { ModelVersionCollector } from "../version/collector";
import { ModelVersionValidator } from "../replay/model_validator";
import { findHandRecordFile } from "../replay/reader";
import type { ReadHandRecordsOptions } from "../replay/reader";

interface CliOptions {
  sessionId?: string;
  file?: string;
  handId?: string;
  limit?: number;
  offset?: number;
  resultsDir?: string;
  strictVersions?: boolean;
  output?: string;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.sessionId && !options.file) {
    throw new Error("Provide either --sessionId or --file");
  }

  const cfgPath =
    process.env.BOT_CONFIG || path.resolve(process.cwd(), "../../config/bot/default.bot.json");
  const configManager = await createConfigManager(cfgPath);
  const loggingConfig = configManager.get<sharedConfig.BotConfig["logging"]>("logging");

  const resultsDir = path.resolve(
    process.cwd(),
    options.resultsDir ?? loggingConfig.outputDir ?? "../../results/hands"
  );
  const sessionPrefix = loggingConfig.sessionPrefix ?? "session";

  const layoutPackConfigPath = configManager.get<string>("vision.layoutPack");
  const baseLayoutDir = path.resolve(process.cwd(), "../../config/layout-packs");
  const layoutFileName = layoutPackConfigPath.endsWith(".json")
    ? layoutPackConfigPath
    : `${layoutPackConfigPath}.layout.json`;
  const resolvedLayoutPath = path.isAbsolute(layoutPackConfigPath)
    ? layoutPackConfigPath
    : path.resolve(baseLayoutDir, layoutFileName);

  const cachePathConfig = configManager.get<string>("gto.cachePath");
  const resolvedCachePath = path.isAbsolute(cachePathConfig)
    ? cachePathConfig
    : path.resolve(process.cwd(), "../../config", cachePathConfig);

  const cacheLoader = new CacheLoader(resolvedCachePath, { logger: console });
  try {
    await cacheLoader.loadCache();
  } catch (error) {
    console.warn("Replay CLI: Failed to load solver cache. Continuing with subgame solves.", error);
  }

  const solverClient = createSolverClient();
  const gtoSolver = new GTOSolver(configManager, { cacheLoader, solverClient }, { logger: console });

  const riskController = createRiskStub();
  const strategyConfig = configManager.get<sharedConfig.BotConfig["strategy"]>("strategy");
  const strategyEngine = new StrategyEngine(strategyConfig, riskController, { logger: console });

  const modelVersionCollector = new ModelVersionCollector({
    configManager,
    cachePath: resolvedCachePath,
    layoutPath: resolvedLayoutPath,
    logger: console
  });
  const modelVersionValidator = new ModelVersionValidator(modelVersionCollector, {
    strict: options.strictVersions,
    logger: console
  });

  const replayEngine = new ReplayEngine({
    configManager,
    gtoSolver,
    strategyEngine,
    trackerFactory: () => new TimeBudgetTracker(),
    modelVersionValidator,
    logger: console
  });

  let filePath = options.file ? path.resolve(process.cwd(), options.file) : undefined;
  if (!filePath && options.sessionId) {
    const resolvedFile = await findHandRecordFile(options.sessionId, resultsDir, sessionPrefix);
    if (!resolvedFile) {
      throw new Error(`No hand history JSONL found for session ${options.sessionId}`);
    }
    filePath = resolvedFile;
  }

  if (!filePath) {
    throw new Error("Unable to resolve hand history file path.");
  }

  const readerOptions: ReadHandRecordsOptions = {
    handId: options.handId,
    limit: options.limit,
    offset: options.offset
  };

  const report = await replayEngine.replayBatch(filePath, readerOptions);

  console.log(`Replay complete for session ${report.sessionId}`);
  console.log(
    `Total: ${report.totalHands}, Successful: ${report.successful}, Matches: ${report.matches}, Mismatches: ${report.mismatches}`
  );
  if (report.modelVersionWarnings.length > 0) {
    console.warn("Model version warnings:");
    report.modelVersionWarnings.forEach((warning: string) => console.warn(`- ${warning}`));
  }

  if (options.output) {
    const outputPath = path.resolve(process.cwd(), options.output);
    await writeFile(outputPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`Report written to ${outputPath}`);
  }
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--sessionId":
        opts.sessionId = argv[++i];
        break;
      case "--file":
        opts.file = argv[++i];
        break;
      case "--handId":
        opts.handId = argv[++i];
        break;
      case "--limit":
        opts.limit = Number(argv[++i]);
        break;
      case "--offset":
        opts.offset = Number(argv[++i]);
        break;
      case "--resultsDir":
        opts.resultsDir = argv[++i];
        break;
      case "--strict-versions":
        opts.strictVersions = true;
        break;
      case "--output":
        opts.output = argv[++i];
        break;
      default:
        break;
    }
  }
  return opts;
}

function createRiskStub(): RiskGuardAPI {
  const snapshot: RiskSnapshot = {
    netProfit: 0,
    drawdown: 0,
    handsPlayed: 0,
    remainingHands: 0,
    remainingBankroll: 0,
    liveExposure: 0,
    panicStop: false,
    updatedAt: Date.now()
  };
  return {
    startHand: () => {},
    incrementHandCount: () => 0,
    recordOutcome: () => snapshot,
    updateLimits: () => snapshot,
    checkLimits: () => ({ allowed: true, snapshot }),
    getSnapshot: () => snapshot,
    resetSession: () => {}
  };
}

main().catch(error => {
  console.error("Replay CLI failed:", error);
  process.exitCode = 1;
});
