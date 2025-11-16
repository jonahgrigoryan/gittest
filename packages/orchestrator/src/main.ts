import { appendFile, mkdir } from "node:fs/promises";
import { GameStateParser } from "./vision/parser";
import { VisionClient } from "./vision/client";
import type { ParserConfig } from "@poker-bot/shared/vision";
import {
  computeConfigHash,
  serializeAgentOutput,
  serializeExecutionResult,
  serializeGameState,
  serializeStrategyDecision,
  summarizeGTOSolution
} from "@poker-bot/shared";
import type {
  GameState,
  GTOSolution,
  Action,
  HandRecord,
  ModelVersions
} from "@poker-bot/shared";
import type { config } from "@poker-bot/shared";
import { CacheLoader, GTOSolver } from "./solver";
import { createSolverClient } from "./solver_client/client";
import { TimeBudgetTracker } from "./budget/timeBudgetTracker";
import { RiskGuard } from "./safety/riskGuard";
import { RiskStateStore } from "./safety/riskStateStore";
import type { RiskCheckOptions, RiskGuardAPI } from "./safety/types";
import type { StrategyConfig, StrategyDecision } from "./strategy/types";
import { StrategyEngine } from "./strategy/engine";
import {
  makeDecision as makeDecisionPipeline
} from "./decision/pipeline";
import type { AggregatedAgentOutput } from "@poker-bot/agents";

import { createActionExecutor, ActionVerifier } from "@poker-bot/executor";
import type { ExecutionResult, ExecutorConfig, VisionClientInterface } from "@poker-bot/executor";
import { createHandHistoryLogger } from "@poker-bot/logger";
import { HealthMonitor } from "./health/monitor";
import { SafeModeController } from "./health/safeModeController";
import { PanicStopController } from "./health/panicStopController";
import { HealthDashboardServer } from "./health/dashboard";
import { HealthMetricsStore } from "./health/metricsStore";
import { ModelVersionCollector } from "./version/collector";

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

  let panicStopControllerRef: PanicStopController | undefined;

  let lastHandId: string | undefined;

  const riskController: RiskController = {
    startHand: (handId, options) => {
      lastHandId = handId;
      riskGuard.startHand(handId, options);
    },
    incrementHandCount: () => riskGuard.incrementHandCount(),
    recordOutcome: update => {
      const snapshot = riskGuard.recordOutcome(update);
      void riskStateStore.save(snapshot);
      if (handLogger) {
        const targetHandId = update.handId ?? lastHandId;
        if (targetHandId) {
          void handLogger.recordOutcome(targetHandId, {
            handId: targetHandId,
            netChips: update.net,
            recordedAt: Date.now()
          });
        }
      }
      return snapshot;
    },
    updateLimits: limits => riskGuard.updateLimits(limits),
    checkLimits: (action, state, options) => {
      const result = riskGuard.checkLimits(action, state, options);
      if (!result.allowed && healthConfig.panicStop.riskGuardAutoTrip && panicStopControllerRef) {
        panicStopControllerRef.trigger({
          type: "risk_limit",
          detail: result.reason ? result.reason.type : "risk_limit",
          triggeredAt: Date.now()
        });
      }
      return result;
    },
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
  const modelVersionCollector = new ModelVersionCollector({
    configManager,
    cachePath: resolvedCachePath,
    layoutPath: resolvedLayoutPath,
    logger: console
  });

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
  const loggingConfig = configManager.get<config.BotConfig["logging"]>("logging");
  const healthConfig = configManager.get<config.BotConfig["monitoring"]["health"]>("monitoring.health");
  const sessionId = process.env.SESSION_ID ?? Date.now().toString(36);
  const logOutputDir = path.resolve(process.cwd(), loggingConfig.outputDir);
  await mkdir(logOutputDir, { recursive: true });
  const handLogger = loggingConfig.enabled
    ? await createHandHistoryLogger({
        sessionId,
        outputDir: logOutputDir,
        sessionPrefix: loggingConfig.sessionPrefix,
        flushIntervalMs: loggingConfig.flushIntervalMs,
        maxFileSizeMb: loggingConfig.maxFileSizeMb,
        retentionDays: loggingConfig.retentionDays,
        formats: loggingConfig.exportFormats,
        redaction: loggingConfig.redaction,
        metrics: loggingConfig.metrics,
        logger: console
      })
    : undefined;
  const resultsDir = path.resolve(process.cwd(), "../../results/session");
  await mkdir(resultsDir, { recursive: true });
  const healthLogPath = path.resolve(resultsDir, `health-${sessionId}.jsonl`);
  const configHash = computeConfigHash(strategyConfig);

  // Create execution infrastructure
  const executionConfig = configManager.get<ExecutorConfig>("execution");

  // Create verifier if execution is enabled
  let verifier: ActionVerifier | undefined;
  if (executionConfig.enabled) {
    const verifierVisionClient: VisionClientInterface = {
      captureAndParse: async () => {
        const snapshot = await visionClient.captureAndParse();
        return {
          confidence: { overall: snapshot.positions?.confidence ?? 1 },
          pot: { amount: snapshot.pot?.amount ?? 0 },
          cards: { communityCards: snapshot.cards?.communityCards ?? [] },
          actionHistory: [],
          players: snapshot.stacks
        };
      }
    };
    verifier = new ActionVerifier(verifierVisionClient, console);
  }

  // Create action executor
  const actionExecutor = executionConfig.enabled
    ? createActionExecutor(executionConfig.mode, executionConfig, verifier, console)
    : undefined;

  const safeModeController = new SafeModeController(console);
  const panicStopController = new PanicStopController(safeModeController, console);
  panicStopControllerRef = panicStopController;
  const healthMetrics = new HealthMetricsStore(healthConfig.panicStop, detail => {
    panicStopController.trigger({
      type: "vision_confidence",
      detail,
      triggeredAt: Date.now()
    });
  });
  let dashboard: HealthDashboardServer | undefined;
  const healthMonitor = new HealthMonitor(healthConfig, {
    logger: console,
    safeMode: safeModeController,
    panicStop: panicStopController,
    onSnapshot: snapshot => {
      void appendFile(healthLogPath, `${JSON.stringify(snapshot)}\n`).catch(error =>
        console.warn("Failed to write health snapshot", error)
      );
      dashboard?.handleSnapshot(snapshot);
    }
  });
  healthMonitor.registerCheck({
    name: "vision",
    fn: async () => ({
      ...healthMetrics.buildVisionStatus(healthConfig.degradedThresholds.visionConfidenceMin),
      checkedAt: Date.now()
    })
  });
  healthMonitor.registerCheck({
    name: "solver",
    fn: async () => ({
      ...healthMetrics.buildSolverStatus(healthConfig.degradedThresholds.solverLatencyMs),
      checkedAt: Date.now()
    })
  });
  healthMonitor.registerCheck({
    name: "executor",
    fn: async () => ({
      ...healthMetrics.buildExecutorStatus(healthConfig.degradedThresholds.executorFailureRate),
      checkedAt: Date.now()
    })
  });
  healthMonitor.registerCheck({
    name: "strategy",
    fn: async () => ({
      ...healthMetrics.buildStrategyStatus(),
      checkedAt: Date.now()
    })
  });
  healthMonitor.start();
  if (healthConfig.dashboard.enabled) {
    dashboard = new HealthDashboardServer(healthConfig.dashboard, healthMonitor, console);
    await dashboard.start();
  }

  async function makeDecision(state: GameState, options: DecisionOptions = {}): Promise<{
    decision: StrategyDecision;
    execution?: ExecutionResult;
  }> {
    healthMetrics.recordVisionSample(state.confidence?.overall ?? 1, Date.now());
    const tracker = ensureTracker(options.tracker);
    lastHandId = state.handId;
    let gtoResult: GTOSolution | undefined;
    let agents: AggregatedAgentOutput | undefined;
    let decision: StrategyDecision;
    let executionResult: ExecutionResult | undefined;
    let solverTimedOut = false;
    let modelVersions: ModelVersions | undefined;

    try {
      modelVersions = await modelVersionCollector.collect();
    } catch (error) {
      console.warn("Model version collection failed", error);
    }

    const finalize = async () => {
      healthMetrics.recordSolverSample(decision.timing.gtoTime, solverTimedOut, Date.now());
      healthMetrics.recordStrategySample(decision, Date.now());
      if (handLogger) {
        const record = buildHandRecord({
          state,
          decision,
          execution: executionResult,
          gto: gtoResult,
          agents,
          sessionId,
          configHash,
          healthSnapshotId: healthMonitor.getLatestSnapshot()?.id,
          modelVersions
        });
        await handLogger.append(record);
      }
      return { decision, execution: executionResult };
    };

    const pipelineResult = await makeDecisionPipeline(state, sessionId, {
      strategyEngine,
      gtoSolver,
      tracker,
      gtoBudgetMs: configManager.get<number>("gto.subgameBudgetMs"),
      logger: console
    });
    decision = pipelineResult.decision;
    gtoResult = pipelineResult.gtoSolution;
    agents = pipelineResult.agentOutput;
    solverTimedOut = pipelineResult.solverTimedOut;

    // 4) Execute the decision if execution is enabled and we have an executor
    if (actionExecutor && executionConfig.enabled && !panicStopController.isActive() && !safeModeController.isActive()) {
      if (tracker.shouldPreempt("execution")) {
        console.warn("Execution preempted due to time budget");
      } else {
        tracker.startComponent("execution");
        try {
          executionResult = await actionExecutor.execute(decision, {
            verifyAction: executionConfig.verifyActions,
            maxRetries: executionConfig.maxRetries,
            timeoutMs: executionConfig.verificationTimeoutMs
          });
          healthMetrics.recordExecutorSample(executionResult.success, Date.now());
        } finally {
          tracker.endComponent("execution");
        }
      }
    } else if (panicStopController.isActive() || safeModeController.isActive()) {
      console.warn(
        `Skipping automatic execution due to ${panicStopController.isActive() ? "panic_stop" : "safe_mode"}`
      );
      healthMetrics.recordExecutorSample(false, Date.now());
    }

    return finalize();
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
    execution: {
      enabled: executionConfig.enabled,
      mode: executionConfig.mode,
      executor: actionExecutor
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

function buildHandRecord(params: {
  state: GameState;
  decision: StrategyDecision;
  execution?: ExecutionResult;
  gto?: GTOSolution;
  agents?: AggregatedAgentOutput;
  sessionId: string;
  configHash: string;
  healthSnapshotId?: string;
  modelVersions?: ModelVersions;
}): HandRecord {
  const {
    state,
    decision,
    execution,
    gto,
    agents,
    sessionId,
    configHash,
    healthSnapshotId,
    modelVersions
  } = params;
  return {
    handId: state.handId,
    sessionId,
    createdAt: Date.now(),
    rawGameState: serializeGameState(state),
    decision: serializeStrategyDecision(decision, configHash),
    execution: serializeExecutionResult(execution),
    solver: summarizeGTOSolution(gto),
    agents: agents ? serializeAgentOutput(agents) : undefined,
    timing: decision.timing,
    metadata: {
      configHash,
      rngSeed: decision.metadata.rngSeed,
      redactionApplied: false,
      healthSnapshotId,
      modelVersions
    }
  };
}
