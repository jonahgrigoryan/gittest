import { GameStateParser } from "./vision/parser";
import { VisionClient } from "./vision/client";
import type { ParserConfig } from "@poker-bot/shared/src/vision/parser-types";
import type { GameState, GTOSolution, Action, ActionType } from "@poker-bot/shared";
import type { config } from "@poker-bot/shared";
import { CacheLoader, GTOSolver } from "./solver";
import { createSolverClient } from "./solver_client/client";
import { TimeBudgetTracker } from "./budget/timeBudgetTracker";
import { RiskGuard } from "./safety/riskGuard";
import { RiskStateStore } from "./safety/riskStateStore";
import type {
  RiskCheckOptions,
  RiskCheckResult,
  RiskSnapshot,
  RiskGuardAPI
} from "./safety/types";
import type { StrategyConfig, StrategyDecision } from "./strategy/types";
import { StrategyEngine } from "./strategy/engine";
import type { AggregatedAgentOutput } from "@poker-bot/agents";

// TODO: inject AgentCoordinator with TimeBudgetTracker once coordinator is implemented.

interface DecisionOptions {
  tracker?: TimeBudgetTracker;
}

type RiskController = RiskGuardAPI;

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
    startHand: (handId, options) => {
      riskGuard.startHand(handId, options);
    },
    incrementHandCount: () => riskGuard.incrementHandCount(),
    recordOutcome: update => {
      const snapshot = riskGuard.recordOutcome(update);
      void riskStateStore.save(snapshot);
      return snapshot;
    },
    updateLimits: limits => riskGuard.updateLimits(limits),
    checkLimits: (action, state, options) => riskGuard.checkLimits(action, state, options),
    getSnapshot: () => riskGuard.getSnapshot(),
    resetSession: () => riskGuard.resetSession()
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

  const strategyConfig = configManager.get<StrategyConfig>("strategy");
  const strategyEngine = new StrategyEngine(strategyConfig, riskController, {
    logger: console,
    timeBudgetTracker: new TimeBudgetTracker()
  });

  async function makeDecision(state: GameState, options: DecisionOptions = {}): Promise<StrategyDecision> {
    const tracker = ensureTracker(options.tracker);

    // 1) Solve GTO under time budget (existing logic).
    if (tracker.shouldPreempt("gto")) {
      const gtoOnly = await gtoSolver.solve(state, 0);
      const agents = createEmptyAggregatedAgentOutput();
      return strategyEngine.decide(state, gtoOnly, agents);
    }

    const configuredBudget = configManager.get<number>("gto.subgameBudgetMs");
    const remainingBudget = tracker.remaining("gto");
    const requestedBudget = Math.max(0, Math.min(configuredBudget, remainingBudget));

    if (requestedBudget <= 0 || !tracker.reserve("gto", requestedBudget)) {
      const gtoOnly = await gtoSolver.solve(state, 0);
      const agents = createEmptyAggregatedAgentOutput();
      return strategyEngine.decide(state, gtoOnly, agents);
    }

    tracker.startComponent("gto");
    try {
      const gto = await gtoSolver.solve(state, requestedBudget);

      // 2) Obtain AggregatedAgentOutput from agents coordinator or stub.
      // TODO: Replace createEmptyAggregatedAgentOutput() with actual coordinator integration.
      const agents = createEmptyAggregatedAgentOutput();

      // 3) Delegate final decision to StrategyEngine (blending, selection, risk, fallbacks).
      return strategyEngine.decide(state, gto, agents);
    } finally {
      const actual = tracker.endComponent("gto");
      if (requestedBudget > actual && tracker.release) {
        tracker.release("gto", requestedBudget - actual);
      }
    }
  }
  
  function createEmptyAggregatedAgentOutput(): AggregatedAgentOutput {
    const now = Date.now();
    const normalizedActions = new Map<ActionType, number>();
    normalizedActions.set("fold", 0);
    normalizedActions.set("check", 0);
    normalizedActions.set("call", 0);
    normalizedActions.set("raise", 0);
  
    return {
      outputs: [],
      normalizedActions,
      consensus: 0,
      winningAction: null,
      budgetUsedMs: 0,
      circuitBreakerTripped: false,
      notes: "stubbed agent output (no agents wired)",
      droppedAgents: [],
      costSummary: {
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0
      },
      startedAt: now,
      completedAt: now
    };
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
      cacheManifest: cacheLoader.getManifest()
    },
    strategy: {
      makeDecision
    },
    budget: {
      createTracker: () => new TimeBudgetTracker()
    },
    risk: {
      statePath: riskStatePath,
      startHand: (handId: string) => {
        riskController.startHand(handId, {});
        riskController.incrementHandCount();
      },
      incrementHandCount: () => riskController.incrementHandCount(),
      recordOutcome: (update: { net: number; hands?: number }) => riskGuard.recordOutcome(update),
      snapshot: () => riskGuard.getSnapshot(),
      checkLimits: (action: Action, state: GameState, options?: RiskCheckOptions) =>
        riskGuard.checkLimits(action, state, options),
      enforceAction: (
        action: Action,
        state: GameState,
        fallbackAction: () => Action,
        options?: RiskCheckOptions
      ) => {
        const result = riskGuard.checkLimits(action, state, options);
        if (result.allowed) {
          return { action, result };
        }
        const safe = fallbackAction();
        return { action: safe, result };
      }
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
