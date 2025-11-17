import path from "node:path";
import type { AgentCoordinator } from "@poker-bot/agents";
import type { StrategyDecision } from "@poker-bot/shared";
import type { ConfigurationManager } from "@poker-bot/shared";
import { CacheLoader } from "@poker-bot/orchestrator/src/solver";
import { GTOSolver } from "@poker-bot/orchestrator/src/solver/solver";
import { createSolverClient } from "@poker-bot/orchestrator/src/solver_client/client";
import { StrategyEngine } from "@poker-bot/orchestrator/src/strategy/engine";
import type { StrategyConfig } from "@poker-bot/orchestrator/src/strategy/types";
import { makeDecision as runDecisionPipeline } from "@poker-bot/orchestrator/src/decision/pipeline";
import { TimeBudgetTracker } from "@poker-bot/orchestrator/src/budget/timeBudgetTracker";
import type { RiskGuardAPI, RiskSnapshot } from "@poker-bot/orchestrator/src/safety/types";
import type { DecisionProvider, DecisionRequestContext } from "../runner/harness";
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

  async nextDecision(handId: string, context: DecisionRequestContext): Promise<StrategyDecision> {
    const state = createSimulatedGameState(handId, context, { bigBlind: context.bigBlind });
    const tracker = new TimeBudgetTracker();
    tracker.start();
    const result = await runDecisionPipeline(state, this.deps.sessionId, {
      strategyEngine: this.deps.strategyEngine,
      gtoSolver: this.deps.gtoSolver,
      agentCoordinator: this.deps.agentCoordinator,
      tracker,
      logger: this.deps.logger
    });
    return result.decision;
  }
}

export async function createPipelineDecisionProvider(
  options: PipelineDecisionProviderOptions
): Promise<PipelineDecisionProvider> {
  const logger = options.logger ?? console;
  const cachePathConfig = options.configManager.get<string>("gto.cachePath");
  const resolvedCachePath = path.isAbsolute(cachePathConfig)
    ? cachePathConfig
    : path.resolve(process.cwd(), "../../config", cachePathConfig);
  const cacheLoader = new CacheLoader(resolvedCachePath, { logger });
  try {
    await cacheLoader.loadCache();
  } catch (error) {
    logger.warn?.("Evaluator: Failed to load GTO cache, continuing with live solves", {
      error: error instanceof Error ? error.message : error
    });
  }

  const solverClient = createSolverClient();
  const gtoSolver = new GTOSolver(options.configManager, { cacheLoader, solverClient }, { logger });
  const strategyConfig = options.configManager.get<StrategyConfig>("strategy");
  const strategyEngine = new StrategyEngine(strategyConfig, createRiskStub(), {
    logger
  });

  return new PipelineDecisionProvider({
    strategyEngine,
    gtoSolver,
    agentCoordinator: options.agentCoordinator,
    sessionId: options.sessionId ?? `eval-${Date.now()}`,
    logger
  });
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
