import { GameStateParser } from "./vision/parser";
import { VisionClient } from "./vision/client";
import type { ParserConfig } from "@poker-bot/shared/src/vision/parser-types";
import type { GameState, GTOSolution } from "@poker-bot/shared";
import { CacheLoader, GTOSolver } from "./solver";
import { createSolverClient } from "./solver_client/client";

export async function run() {
  const path = await import("path");
  const shared = await import("@poker-bot/shared");
  const { createConfigManager, vision } = shared;

  const cfgPath = process.env.BOT_CONFIG || path.resolve(process.cwd(), "../../config/bot/default.bot.json");
  const configManager = await createConfigManager(cfgPath);

  if (process.env.CONFIG_WATCH === "1") {
    await configManager.startWatching();
  }

  if (process.env.ORCH_PING_SOLVER === "1") {
    const pingClient = createSolverClient();
    pingClient.close();
  }

  const layoutPackConfigPath = configManager.get<string>("vision.layoutPack");
  const baseLayoutDir = path.resolve(process.cwd(), "../../config/layout-packs");
  const layoutFileName = layoutPackConfigPath.endsWith(".json")
    ? layoutPackConfigPath
    : `${layoutPackConfigPath}.layout.json`;
  const resolvedLayoutPath = path.isAbsolute(layoutPackConfigPath)
    ? layoutPackConfigPath
    : path.resolve(baseLayoutDir, layoutFileName);

  let layoutPack;
  try {
    layoutPack = vision.loadLayoutPack(resolvedLayoutPath);
  } catch (error) {
    console.warn(`Failed to load layout pack at ${resolvedLayoutPath}:`, error);
    layoutPack = vision.loadLayoutPack(path.resolve(baseLayoutDir, "simulator/default.layout.json"));
  }

  const parserConfig: ParserConfig = {
    confidenceThreshold: configManager.get<number>("vision.confidenceThreshold"),
    occlusionThreshold: configManager.get<number>("vision.occlusionThreshold"),
    enableInference: true
  };

  const parser = new GameStateParser(parserConfig);
  void parser;

  const visionServiceUrl = process.env.VISION_SERVICE_URL ?? "0.0.0.0:50052";
  const visionClient = new VisionClient(visionServiceUrl, layoutPack);

  if (process.env.ORCH_PING_VISION === "1") {
    try {
      await visionClient.healthCheck();
    } catch (error) {
      console.warn("Vision service health check failed:", error);
    } finally {
      visionClient.close();
    }
  } else {
    visionClient.close();
  }

  const cachePathConfig = configManager.get<string>("gto.cachePath");
  const resolvedCachePath = path.isAbsolute(cachePathConfig)
    ? cachePathConfig
    : path.resolve(process.cwd(), "../../config", cachePathConfig);

  const cacheLoader = new CacheLoader(resolvedCachePath, { logger: console });
  try {
    await cacheLoader.loadCache();
  } catch (error) {
    console.warn("Failed to load solver cache. Subgame solves will be used for all streets.", error);
  }

  const solverClient = createSolverClient();
  const gtoSolver = new GTOSolver(configManager, { cacheLoader, solverClient }, { logger: console });

  async function makeDecision(state: GameState): Promise<GTOSolution> {
    const budget = configManager.get<number>("gto.subgameBudgetMs");
    return gtoSolver.solve(state, budget);
  }

  return {
    ok: true,
    configLoaded: !!configManager,
    vision: {
      serviceUrl: visionServiceUrl,
      layoutPath: resolvedLayoutPath,
      parserConfig
    },
    solver: {
      cachePath: resolvedCachePath,
      cacheManifest: cacheLoader.getManifest(),
      makeDecision
    }
  };
}
