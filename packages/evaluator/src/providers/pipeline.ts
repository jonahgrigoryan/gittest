import path from "node:path";
import type { AgentCoordinator, AgentTransport } from "@poker-bot/agents";
import { AgentCoordinatorService, MockTransport } from "@poker-bot/agents";
import type { StrategyDecision } from "@poker-bot/shared";
import type { ConfigurationManager, AgentModelConfig } from "@poker-bot/shared";
import {
  CacheLoader,
  GTOSolver,
  StrategyEngine,
  makeDecision as runDecisionPipeline,
  createSolverClient,
  TimeBudgetTracker,
  type StrategyConfig,
  type RiskGuardAPI,
  type RiskSnapshot,
} from "@poker-bot/orchestrator";
import type {
  DecisionProvider,
  DecisionRequestContext,
} from "../runner/harness";
import { createSimulatedGameState } from "../simulator/state";

interface ProviderDeps {
  strategyEngine: StrategyEngine;
  gtoSolver: GTOSolver;
  agentCoordinator?: AgentCoordinator;
  sessionId: string;
  logger?: Pick<Console, "debug" | "info" | "warn" | "error">;
}

export interface PipelineDecisionProviderOptions {
  configManager: ConfigurationManager;
  sessionId?: string;
  agentCoordinator?: AgentCoordinator;
  logger?: Pick<Console, "debug" | "info" | "warn" | "error">;
}

export class PipelineDecisionProvider implements DecisionProvider {
  constructor(private readonly deps: ProviderDeps) {}

  async nextDecision(
    handId: string,
    context: DecisionRequestContext,
  ): Promise<StrategyDecision> {
    const state = createSimulatedGameState(handId, context, {
      bigBlind: context.bigBlind,
    });
    const tracker = new TimeBudgetTracker();
    tracker.start();
    const result = await runDecisionPipeline(state, this.deps.sessionId, {
      strategyEngine: this.deps.strategyEngine,
      gtoSolver: this.deps.gtoSolver,
      agentCoordinator: this.deps.agentCoordinator,
      tracker,
      logger: this.deps.logger,
    });
    return result.decision;
  }
}

export async function createPipelineDecisionProvider(
  options: PipelineDecisionProviderOptions,
): Promise<PipelineDecisionProvider> {
  const logger = options.logger ?? console;
  const cachePathConfig = options.configManager.get<string>("gto.cachePath");
  const resolvedCachePath = path.isAbsolute(cachePathConfig)
    ? cachePathConfig
    : path.resolve(process.cwd(), "config", cachePathConfig);
  const cacheLoader = new CacheLoader(resolvedCachePath, { logger });
  try {
    await cacheLoader.loadCache();
  } catch (error) {
    logger.warn?.(
      "Evaluator: Failed to load GTO cache, continuing with live solves",
      {
        error: error instanceof Error ? error.message : error,
      },
    );
  }

  const solverClient = createSolverClient();
  const gtoSolver = new GTOSolver(
    options.configManager,
    { cacheLoader, solverClient },
    { logger },
  );
  const sharedTracker = new TimeBudgetTracker();
  const strategyConfig = options.configManager.get<StrategyConfig>("strategy");
  const strategyEngine = new StrategyEngine(strategyConfig, createRiskStub(), {
    logger,
    timeBudgetTracker: sharedTracker,
  });

  // Create agent coordinator - use provided one or create mock for evaluation
  let agentCoordinator = options.agentCoordinator;
  if (!agentCoordinator) {
    const useMockAgents = process.env.AGENTS_USE_MOCK === "1";
    let agentModels =
      safeGetConfig<AgentModelConfig[]>(
        options.configManager,
        "agents.models",
      ) ?? [];

    // Inject synthetic mock model when using mock mode with no real models
    if (useMockAgents && agentModels.length === 0) {
      agentModels = [createSyntheticMockModel()];
    }

    if (agentModels.length > 0) {
      const transports = createEvaluatorTransports(agentModels);
      if (transports.size > 0) {
        const agentConfigManager = useMockAgents
          ? (createMockConfigProxy(
              options.configManager,
              agentModels,
            ) as unknown as ConfigurationManager)
          : options.configManager;

        agentCoordinator = new AgentCoordinatorService({
          // Use config proxy to inject synthetic models
          configManager: agentConfigManager,
          transports,
          timeBudgetTracker: sharedTracker,
          logger,
        });
      }
    }
  }

  return new PipelineDecisionProvider({
    strategyEngine,
    gtoSolver,
    agentCoordinator,
    sessionId: options.sessionId ?? `eval-${Date.now()}`,
    logger,
  });
}

function safeGetConfig<T>(
  configManager: { get: <R>(key: string) => R },
  key: string,
): T | undefined {
  try {
    return configManager.get<T>(key);
  } catch {
    return undefined;
  }
}

const MOCK_MODEL_ID = "mock-default";

function createSyntheticMockModel(): AgentModelConfig {
  return {
    name: "mock-agent",
    provider: "local",
    modelId: MOCK_MODEL_ID,
    persona: "gto_purist",
    promptTemplate: "Mock agent for evaluation testing",
  };
}

type ConfigManagerGet = Pick<ConfigurationManager, "get">;

function createMockConfigProxy(
  configManager: ConfigurationManager,
  injectedModels: AgentModelConfig[],
): ConfigManagerGet {
  return {
    get: <T>(key: string): T => {
      if (key === "agents.models") {
        return injectedModels as T;
      }
      return configManager.get<T>(key);
    },
  };
}

function createEvaluatorTransports(
  models: AgentModelConfig[],
): Map<string, AgentTransport> {
  const transports = new Map<string, AgentTransport>();

  for (const model of models) {
    const transportId = model.modelId;
    if (transports.has(transportId)) continue;

    // For evaluation, always use mock transport (evaluation doesn't call real LLMs)
    const mock = new MockTransport({
      id: transportId,
      modelId: transportId,
      provider: "local",
    });
    mock.enqueueResponse({
      raw: JSON.stringify({
        action: "call",
        confidence: 0.6,
        reasoning: "Evaluator mock response",
      }),
      latencyMs: 15,
    });
    transports.set(transportId, mock);
  }

  return transports;
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
    updatedAt: Date.now(),
  };
  return {
    startHand: () => {},
    incrementHandCount: () => 0,
    recordOutcome: () => snapshot,
    updateLimits: () => snapshot,
    checkLimits: () => ({ allowed: true, snapshot }),
    getSnapshot: () => snapshot,
    resetSession: () => {},
  };
}
