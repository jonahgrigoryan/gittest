import { GameStateParser } from "./vision/parser";
import { VisionClient } from "./vision/client";
import type { ParserConfig } from "@poker-bot/shared/src/vision/parser-types";
import type { GameState, GTOSolution, Action } from "@poker-bot/shared";
import type { config } from "@poker-bot/shared";
import { CacheLoader, GTOSolver } from "./solver";
import { createSolverClient } from "./solver_client/client";
import { TimeBudgetTracker } from "./budget/timeBudgetTracker";
import { RiskGuard } from "./safety/riskGuard";
import { RiskStateStore } from "./safety/riskStateStore";
import type { RiskCheckOptions, RiskCheckResult, RiskSnapshot } from "./safety/types";

// TODO: inject AgentCoordinator with TimeBudgetTracker once coordinator is implemented.

interface DecisionOptions {
  tracker?: TimeBudgetTracker;
}

interface RiskController {
  startHand(handId: string): void;
  incrementHandCount(): number;
  recordOutcome(update: { net: number; hands?: number }): Promise<RiskSnapshot>;
  check(action: Action, state: GameState, options?: RiskCheckOptions): RiskCheckResult;
  enforce(
    action: Action,
    state: GameState,
    fallbackAction: () => Action,
    options?: RiskCheckOptions
  ): { action: Action; result: RiskCheckResult };
  snapshot(): RiskSnapshot;
}

export async function run() {
  const path = await import("path");
  const shared = await import("@poker-bot/shared");
  const { createConfigManager, vision } = shared;

  const cfgPath = process.env.BOT_CONFIG || path.resolve(process.cwd(), "../../config/bot/default.bot.json");
  const configManager = await createConfigManager(cfgPath);

  if (process.env.CONFIG_WATCH === "1") {
    await configManager.startWatching();
  }

  const safetyConfig = configManager.get<config.BotConfig["safety"]>("safety");
  const riskStatePath = process.env.RISK_STATE_PATH
    ? path.resolve(process.env.RISK_STATE_PATH)
    : path.resolve(process.cwd(), "../../results/session/risk-state.json");
  const riskStateStore = new RiskStateStore(riskStatePath);
  const persistedRisk = await riskStateStore.load();
  const riskGuard = new RiskGuard(
    {
      bankrollLimit: safetyConfig.bankrollLimit,
      sessionLimit: safetyConfig.sessionLimit,
      currentBankroll: persistedRisk.currentBankroll,
      currentSessionHands: persistedRisk.currentSessionHands,
    },
    {
      logger: console,
      onPanicStop: event => {
        riskStateStore.save(event.snapshot).catch(error => {
          console.error("Failed to persist risk snapshot after panic stop", error);
        });
      },
    }
  );

  configManager.subscribe("safety", value => {
    const next = value as config.BotConfig["safety"];
    riskGuard.updateLimits({ bankrollLimit: next.bankrollLimit, sessionLimit: next.sessionLimit });
  });

  const riskController: RiskController = {
    startHand: handId => {
      riskGuard.startHand(handId);
    },
    incrementHandCount: () => riskGuard.incrementHandCount(),
    recordOutcome: async update => {
      const snapshot = riskGuard.recordOutcome(update);
      await riskStateStore.save(snapshot);
      return snapshot;
    },
    check: (action, state, options) => riskGuard.checkLimits(action, state, options),
    enforce: (action, state, fallbackAction, options) => {
      const result = riskGuard.checkLimits(action, state, options);
      if (result.allowed) {
        return { action, result };
      }
      const safe = fallbackAction();
      return { action: safe, result };
    },
    snapshot: () => riskGuard.getSnapshot(),
  };

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

  async function makeDecision(state: GameState, options: DecisionOptions = {}): Promise<GTOSolution> {
    const tracker = ensureTracker(options.tracker);
    if (tracker.shouldPreempt("gto")) {
      return gtoSolver.solve(state, 0);
    }

    const configuredBudget = configManager.get<number>("gto.subgameBudgetMs");
    const remainingBudget = tracker.remaining("gto");
    const requestedBudget = Math.max(0, Math.min(configuredBudget, remainingBudget));

    if (requestedBudget <= 0 || !tracker.reserve("gto", requestedBudget)) {
      return gtoSolver.solve(state, 0);
    }

    tracker.startComponent("gto");
    try {
      return await gtoSolver.solve(state, requestedBudget);
    } finally {
      const actual = tracker.endComponent("gto");
      if (requestedBudget > actual && tracker.release) {
        tracker.release("gto", requestedBudget - actual);
      }
    }
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
    },
    budget: {
      createTracker: () => new TimeBudgetTracker()
    },
    risk: {
      statePath: riskStatePath,
      startHand: (handId: string) => {
        riskController.startHand(handId);
        riskController.incrementHandCount();
      },
      incrementHandCount: () => riskController.incrementHandCount(),
      recordOutcome: (update: { net: number; hands?: number }) => riskController.recordOutcome(update),
      snapshot: () => riskController.snapshot(),
      checkLimits: (action: Action, state: GameState, options?: RiskCheckOptions) =>
        riskController.check(action, state, options),
      enforceAction: (
        action: Action,
        state: GameState,
        fallbackAction: () => Action,
        options?: RiskCheckOptions
      ) => riskController.enforce(action, state, fallbackAction, options)
    }
  };
}

function ensureTracker(existing?: TimeBudgetTracker): TimeBudgetTracker {
  if (existing) {
    existing.start?.();
    return existing;
  }
  const tracker = new TimeBudgetTracker();
  tracker.start();
  return tracker;
}
