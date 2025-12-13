import { appendFile, mkdir } from "node:fs/promises";
import { createConfigManager } from "@poker-bot/shared";
import type {
  AgentModelConfig,
  BotConfig,
  ObservabilityConfig,
} from "@poker-bot/shared";
import { assertEnvVars } from "@poker-bot/shared";
import type { EvaluationMode, EvaluationRunMetadata } from "@poker-bot/shared";
import type { HandRecord, ModelVersions } from "@poker-bot/shared";
import {
  computeConfigHash,
  serializeAgentOutput,
  serializeExecutionResult,
  serializeGameState,
  serializeStrategyDecision,
  summarizeGTOSolution,
} from "@poker-bot/shared";
import type { Action, GameState, GTOSolution } from "@poker-bot/shared";
import type { ParserConfig } from "@poker-bot/shared";
import { vision } from "@poker-bot/shared";
import { GameStateParser } from "./vision/parser";
import { VisionClient } from "./vision/client";
import { CacheLoader, GTOSolver } from "./solver";
import { createSolverClient } from "./solver_client/client";
import { TimeBudgetTracker } from "./budget/timeBudgetTracker";
import { RiskGuard } from "./safety/riskGuard";
import { RiskStateStore } from "./safety/riskStateStore";
import type { RiskCheckOptions, RiskGuardAPI } from "./safety/types";
import type { StrategyConfig, StrategyDecision } from "./strategy/types";
import { StrategyEngine } from "./strategy/engine";
import { makeDecision as makeDecisionPipeline } from "./decision/pipeline";
import type {
  AggregatedAgentOutput,
  AgentCoordinator,
  AgentTransport,
} from "@poker-bot/agents";
import {
  AgentCoordinatorService,
  OpenAITransport,
  MockTransport,
} from "@poker-bot/agents";

import { createActionExecutor, ActionVerifier } from "@poker-bot/executor";
import type {
  ExecutionResult,
  ExecutorConfig,
  VisionClientInterface,
} from "@poker-bot/executor";
import { createHandHistoryLogger } from "@poker-bot/logger";
import { HealthMonitor } from "./health/monitor";
import { SafeModeController } from "./health/safeModeController";
import { PanicStopController } from "./health/panicStopController";
import { HealthDashboardServer } from "./health/dashboard";
import { HealthMetricsStore } from "./health/metricsStore";
import { ModelVersionCollector } from "./version/collector";
import { ObservabilityService } from "./observability/service";
import { AlertManager } from "./observability/alertManager";
import { validateStartupConnectivity } from "./startup/validateConnectivity";

interface DecisionOptions {
  tracker?: TimeBudgetTracker;
}

type RiskController = RiskGuardAPI;

export async function run() {
  assertEnvVars("orchestrator");
  const path = await import("path");

  const cfgPath =
    process.env.BOT_CONFIG ||
    path.resolve(process.cwd(), "../../config/bot/default.bot.json");
  const configManager = await createConfigManager(cfgPath);

  if (process.env.CONFIG_WATCH === "1") {
    await configManager.startWatching();
  }

  const safetyConfig = configManager.get<BotConfig["safety"]>("safety");
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
      onPanicStop: (event) => {
        riskStateStore.save(event.snapshot).catch((error) => {
          console.error(
            "Failed to persist risk snapshot after panic stop",
            error,
          );
        });
      },
    },
  );

  configManager.subscribe("safety", (value) => {
    const next = value as BotConfig["safety"];
    riskGuard.updateLimits({
      bankrollLimit: next.bankrollLimit,
      sessionLimit: next.sessionLimit,
    });
  });

  let panicStopControllerRef: PanicStopController | undefined;

  let lastHandId: string | undefined;

  const riskController: RiskController = {
    startHand: (handId, options) => {
      lastHandId = handId;
      riskGuard.startHand(handId, options);
    },
    incrementHandCount: () => riskGuard.incrementHandCount(),
    recordOutcome: (update) => {
      const snapshot = riskGuard.recordOutcome(update);
      void riskStateStore.save(snapshot);
      if (handLogger) {
        const targetHandId = update.handId ?? lastHandId;
        if (targetHandId) {
          void handLogger.recordOutcome(targetHandId, {
            handId: targetHandId,
            netChips: update.net,
            recordedAt: Date.now(),
          });
        }
      }
      return snapshot;
    },
    updateLimits: (limits) => riskGuard.updateLimits(limits),
    checkLimits: (action, state, options) => {
      const result = riskGuard.checkLimits(action, state, options);
      if (
        !result.allowed &&
        healthConfig.panicStop.riskGuardAutoTrip &&
        panicStopControllerRef
      ) {
        panicStopControllerRef.trigger({
          type: "risk_limit",
          detail: result.reason ? result.reason.type : "risk_limit",
          triggeredAt: Date.now(),
        });
      }
      return result;
    },
    getSnapshot: () => riskGuard.getSnapshot(),
    resetSession: () => riskGuard.resetSession(),
  };

  const layoutPackConfigPath = configManager.get<string>("vision.layoutPack");
  const baseLayoutDir = path.resolve(
    process.cwd(),
    "../../config/layout-packs",
  );
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
    layoutPack = vision.loadLayoutPack(
      path.resolve(baseLayoutDir, "simulator/default.layout.json"),
    );
  }

  const parserConfig: ParserConfig = {
    confidenceThreshold: configManager.get<number>(
      "vision.confidenceThreshold",
    ),
    occlusionThreshold: configManager.get<number>("vision.occlusionThreshold"),
    enableInference: true,
  };

  const parser = new GameStateParser(parserConfig);
  void parser;

  const visionServiceUrl = process.env.VISION_SERVICE_URL ?? "0.0.0.0:50052";
  const useMockAgents = process.env.AGENTS_USE_MOCK === "1";
  let agentModelsConfig = (
    configManager.get<AgentModelConfig[]>("agents.models") ?? []
  ).filter((m) => m && m.modelId);

  // Inject synthetic mock model when AGENTS_USE_MOCK=1 and no real models configured
  if (useMockAgents && agentModelsConfig.length === 0) {
    agentModelsConfig = [createSyntheticMockModel()];
  }

  const requireAgentConnectivity = agentModelsConfig.length > 0;

  await validateStartupConnectivity({
    solverAddr: process.env.SOLVER_ADDR ?? "127.0.0.1:50051",
    visionServiceUrl,
    layoutPack,
    requireAgentConnectivity,
    useMockAgents: useMockAgents && requireAgentConnectivity,
    logger: console,
  });

  const cachePathConfig = configManager.get<string>("gto.cachePath");
  const resolvedCachePath = path.isAbsolute(cachePathConfig)
    ? cachePathConfig
    : path.resolve(process.cwd(), "../../config", cachePathConfig);
  const modelVersionCollector = new ModelVersionCollector({
    configManager,
    cachePath: resolvedCachePath,
    layoutPath: resolvedLayoutPath,
    logger: console,
  });

  const cacheLoader = new CacheLoader(resolvedCachePath, { logger: console });
  try {
    await cacheLoader.loadCache();
  } catch (error) {
    console.warn(
      "Failed to load solver cache. Subgame solves will be used for all streets.",
      error,
    );
  }

  const solverClient = createSolverClient();
  const gtoSolver = new GTOSolver(
    configManager,
    { cacheLoader, solverClient },
    { logger: console },
  );

  // Create shared TimeBudgetTracker for strategy engine and agents
  const sharedBudgetTracker = new TimeBudgetTracker();

  const strategyConfig = configManager.get<StrategyConfig>("strategy");
  const strategyEngine = new StrategyEngine(strategyConfig, riskController, {
    logger: console,
    timeBudgetTracker: sharedBudgetTracker,
  });

  // Create AgentCoordinator if agent models are configured (real or synthetic mock)
  let agentCoordinator: AgentCoordinator | undefined;
  if (agentModelsConfig.length > 0) {
    const transports = createAgentTransports(agentModelsConfig, useMockAgents);
    agentCoordinator = new AgentCoordinatorService({
      // Use a config proxy that injects the synthetic model when mock mode is active
      configManager: (useMockAgents
        ? createMockConfigProxy(configManager, agentModelsConfig)
        : // eslint-disable-next-line @typescript-eslint/no-explicit-any
          configManager) as any,
      transports,
      timeBudgetTracker: sharedBudgetTracker,
      logger: console,
    });
  }
  const loggingConfig = configManager.get<BotConfig["logging"]>("logging");
  const healthConfig =
    configManager.get<BotConfig["monitoring"]["health"]>("monitoring.health");
  const sessionId = process.env.SESSION_ID ?? Date.now().toString(36);
  const evaluationMetadata = resolveEvaluationMetadataFromEnv();
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
        logger: console,
        evaluation: evaluationMetadata,
      })
    : undefined;
  const resultsDir = path.resolve(process.cwd(), "../../results/session");
  await mkdir(resultsDir, { recursive: true });
  const healthLogPath = path.resolve(resultsDir, `health-${sessionId}.jsonl`);
  const observabilityConfig = configManager.get<ObservabilityConfig>(
    "monitoring.observability",
  );
  const sessionDir = path.join(resultsDir, sessionId);
  await mkdir(sessionDir, { recursive: true });
  const observabilityService = new ObservabilityService({
    sessionId,
    sessionDir,
    config: observabilityConfig,
    logger: console,
  });
  await observabilityService.init();
  const alertManager = new AlertManager(
    observabilityConfig.alerts,
    observabilityService,
  );
  observabilityService.registerAlertConsumer(alertManager);
  process.on("beforeExit", () => {
    void observabilityService.flush();
  });
  configManager.subscribe("monitoring.observability", (value) => {
    const next = value as ObservabilityConfig;
    alertManager.updateConfig(next.alerts);
    void observabilityService.applyConfig(next);
  });
  const configHash = computeConfigHash(strategyConfig);

  // Create execution infrastructure
  const executionConfig = configManager.get<ExecutorConfig>("execution");

  // Create verifier if execution is enabled
  let verifier: ActionVerifier | undefined;
  if (executionConfig.enabled) {
    const executionVisionClient = new VisionClient(
      visionServiceUrl,
      layoutPack,
    );
    process.on("beforeExit", () => {
      executionVisionClient.close();
    });
    const verifierVisionClient: VisionClientInterface = {
      captureAndParse: async () => {
        const snapshot = await executionVisionClient.captureAndParse();
        const players =
          snapshot?.stacks instanceof Map
            ? new Map(
                Array.from(snapshot.stacks.entries()).map(
                  ([position, entry]) => [position, { stack: entry.amount }],
                ),
              )
            : new Map();
        return {
          confidence: { overall: snapshot?.positions?.confidence ?? 1 },
          pot: { amount: snapshot?.pot?.amount ?? 0 },
          cards: { communityCards: snapshot?.cards?.communityCards ?? [] },
          actionHistory: [],
          players,
        };
      },
    };
    verifier = new ActionVerifier(verifierVisionClient, console);
  }

  // Create action executor
  const actionExecutor = executionConfig.enabled
    ? createActionExecutor(
        executionConfig.mode,
        executionConfig,
        verifier,
        console,
      )
    : undefined;

  const safeModeController = new SafeModeController(console);
  const panicStopController = new PanicStopController(
    safeModeController,
    console,
  );
  panicStopControllerRef = panicStopController;
  const healthMetrics = new HealthMetricsStore(
    healthConfig.panicStop,
    (detail) => {
      panicStopController.trigger({
        type: "vision_confidence",
        detail,
        triggeredAt: Date.now(),
      });
    },
  );
  let dashboard: HealthDashboardServer | undefined;
  const healthMonitor = new HealthMonitor(healthConfig, {
    logger: console,
    safeMode: safeModeController,
    panicStop: panicStopController,
    onSnapshot: (snapshot) => {
      void appendFile(healthLogPath, `${JSON.stringify(snapshot)}\n`).catch(
        (error) => console.warn("Failed to write health snapshot", error),
      );
      observabilityService.recordHealthSnapshot(snapshot);
      dashboard?.handleSnapshot(snapshot);
    },
  });
  healthMonitor.registerCheck({
    name: "vision",
    fn: async () => ({
      ...healthMetrics.buildVisionStatus(
        healthConfig.degradedThresholds.visionConfidenceMin,
      ),
      checkedAt: Date.now(),
    }),
  });
  healthMonitor.registerCheck({
    name: "solver",
    fn: async () => ({
      ...healthMetrics.buildSolverStatus(
        healthConfig.degradedThresholds.solverLatencyMs,
      ),
      checkedAt: Date.now(),
    }),
  });
  healthMonitor.registerCheck({
    name: "executor",
    fn: async () => ({
      ...healthMetrics.buildExecutorStatus(
        healthConfig.degradedThresholds.executorFailureRate,
      ),
      checkedAt: Date.now(),
    }),
  });
  healthMonitor.registerCheck({
    name: "strategy",
    fn: async () => ({
      ...healthMetrics.buildStrategyStatus(),
      checkedAt: Date.now(),
    }),
  });
  healthMonitor.start();
  if (healthConfig.dashboard.enabled) {
    dashboard = new HealthDashboardServer(
      healthConfig.dashboard,
      healthMonitor,
      console,
    );
    await dashboard.start();
  }

  async function makeDecision(
    state: GameState,
    options: DecisionOptions = {},
  ): Promise<{
    decision: StrategyDecision;
    execution?: ExecutionResult;
  }> {
    healthMetrics.recordVisionSample(
      state.confidence?.overall ?? 1,
      Date.now(),
    );
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
      healthMetrics.recordSolverSample(
        decision.timing.gtoTime,
        solverTimedOut,
        Date.now(),
      );
      healthMetrics.recordStrategySample(decision, Date.now());
      const record = buildHandRecord({
        state,
        decision,
        execution: executionResult,
        gto: gtoResult,
        agents,
        sessionId,
        configHash,
        healthSnapshotId: healthMonitor.getLatestSnapshot()?.id,
        modelVersions,
      });
      observabilityService.recordDecision(record);
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
          modelVersions,
          evaluation: evaluationMetadata,
        });
        await handLogger.append(record);
      }
      return { decision, execution: executionResult };
    };

    const pipelineResult = await makeDecisionPipeline(state, sessionId, {
      strategyEngine,
      gtoSolver,
      agentCoordinator,
      tracker,
      gtoBudgetMs: configManager.get<number>("gto.subgameBudgetMs"),
      logger: console,
    });
    decision = pipelineResult.decision;
    gtoResult = pipelineResult.gtoSolution;
    agents = pipelineResult.agentOutput;
    solverTimedOut = pipelineResult.solverTimedOut;
    if (agents?.costSummary) {
      observabilityService.recordAgentTelemetry({
        totalTokens: agents.costSummary.totalTokens,
        totalCostUsd: agents.costSummary.totalCostUsd,
      });
    }

    // 4) Execute the decision if execution is enabled and we have an executor
    if (
      actionExecutor &&
      executionConfig.enabled &&
      !panicStopController.isActive() &&
      !safeModeController.isActive()
    ) {
      if (tracker.shouldPreempt("execution")) {
        console.warn("Execution preempted due to time budget");
      } else {
        tracker.startComponent("execution");
        try {
          executionResult = await actionExecutor.execute(decision, {
            verifyAction: executionConfig.verifyActions,
            maxRetries: executionConfig.maxRetries,
            timeoutMs: executionConfig.verificationTimeoutMs,
          });
          healthMetrics.recordExecutorSample(
            executionResult.success,
            Date.now(),
          );
        } finally {
          tracker.endComponent("execution");
        }
      }
    } else if (
      panicStopController.isActive() ||
      safeModeController.isActive()
    ) {
      console.warn(
        `Skipping automatic execution due to ${panicStopController.isActive() ? "panic_stop" : "safe_mode"}`,
      );
      healthMetrics.recordExecutorSample(false, Date.now());
    }
    if (executionResult) {
      observabilityService.recordExecutionResult(executionResult.success);
    }

    return finalize();
  }

  return {
    ok: true,
    configLoaded: !!configManager,
    vision: {
      serviceUrl: visionServiceUrl,
      layoutPath: resolvedLayoutPath,
      parserConfig,
    },
    solver: {
      cachePath: resolvedCachePath,
      cacheManifest: cacheLoader.getManifest(),
    },
    strategy: {
      makeDecision,
    },
    execution: {
      enabled: executionConfig.enabled,
      mode: executionConfig.mode,
      executor: actionExecutor,
    },
    budget: {
      createTracker: () => new TimeBudgetTracker(),
      sharedTracker: sharedBudgetTracker,
    },
    agents: {
      coordinator: agentCoordinator,
      modelsConfigured: agentModelsConfig.length,
    },
    risk: {
      statePath: riskStatePath,
      startHand: (handId: string) => {
        riskController.startHand(handId, {});
        riskController.incrementHandCount();
      },
      incrementHandCount: () => riskController.incrementHandCount(),
      recordOutcome: (update: { net: number; hands?: number }) =>
        riskGuard.recordOutcome(update),
      snapshot: () => riskGuard.getSnapshot(),
      checkLimits: (
        action: Action,
        state: GameState,
        options?: RiskCheckOptions,
      ) => riskGuard.checkLimits(action, state, options),
      enforceAction: (
        action: Action,
        state: GameState,
        fallbackAction: () => Action,
        options?: RiskCheckOptions,
      ) => {
        const result = riskGuard.checkLimits(action, state, options);
        if (result.allowed) {
          return { action, result };
        }
        const safe = fallbackAction();
        return { action: safe, result };
      },
    },
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
  evaluation?: EvaluationRunMetadata;
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
    modelVersions,
    evaluation,
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
      modelVersions,
      evaluation,
    },
  };
}

function resolveEvaluationMetadataFromEnv(): EvaluationRunMetadata | undefined {
  const runId = process.env.EVALUATION_RUN_ID;
  const mode = process.env.EVALUATION_MODE as EvaluationMode | undefined;
  if (!runId || !mode) {
    return undefined;
  }
  const opponentId = process.env.EVALUATION_OPPONENT_ID;
  return {
    runId,
    mode,
    opponentId: opponentId && opponentId.length > 0 ? opponentId : undefined,
  };
}

function createAgentTransports(
  models: AgentModelConfig[],
  useMock: boolean,
): Map<string, AgentTransport> {
  const transports = new Map<string, AgentTransport>();
  const openAiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  for (const model of models) {
    const transportId = model.modelId;
    if (transports.has(transportId)) {
      continue;
    }

    // Use mock transport when AGENTS_USE_MOCK=1
    if (useMock) {
      const mock = new MockTransport({
        id: transportId,
        modelId: transportId,
        provider: "local",
      });
      // Enqueue a default response so the mock actually returns data
      mock.enqueueResponse({
        raw: JSON.stringify({
          action: "call",
          confidence: 0.65,
          reasoning: "Mock agent response for testing",
        }),
        latencyMs: 25,
      });
      transports.set(transportId, mock);
      continue;
    }

    // Determine provider from modelId prefix or explicit config
    const isOpenAi =
      transportId.startsWith("gpt-") ||
      transportId.startsWith("o1-") ||
      transportId.includes("openai");
    const isAnthropic =
      transportId.startsWith("claude-") || transportId.includes("anthropic");

    if (isOpenAi && openAiKey) {
      transports.set(
        transportId,
        new OpenAITransport({
          id: transportId,
          modelId: transportId,
          apiKey: openAiKey,
          baseUrl: process.env.OPENAI_BASE_URL,
          provider: "openai",
        }),
      );
    } else if (isAnthropic && anthropicKey) {
      transports.set(
        transportId,
        new OpenAITransport({
          id: transportId,
          modelId: transportId,
          apiKey: anthropicKey,
          baseUrl:
            process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1",
          provider: "anthropic",
        }),
      );
    }
  }

  return transports;
}

const MOCK_MODEL_ID = "mock-default";

function createSyntheticMockModel(): AgentModelConfig {
  return {
    name: "mock-agent",
    provider: "local",
    modelId: MOCK_MODEL_ID,
    persona: "gto_purist",
    promptTemplate:
      "Mock agent for testing - respond with action and confidence",
  };
}

function createMockConfigProxy(
  configManager: { get: <T>(key: string) => T },
  injectedModels: AgentModelConfig[],
): { get: <T>(key: string) => T } {
  return {
    get: <T>(key: string): T => {
      if (key === "agents.models") {
        return injectedModels as T;
      }
      return configManager.get<T>(key);
    },
  };
}
