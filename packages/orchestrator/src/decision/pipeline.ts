import type { GameState, GTOSolution, StrategyDecision, ActionType } from "@poker-bot/shared";
import type {
  AggregatedAgentOutput,
  AgentCoordinator,
  PromptContext,
  AgentQueryOptions
} from "@poker-bot/agents";
import type { StrategyEngine } from "../strategy/engine";
import type { GTOSolver } from "../solver/solver";
import type { TimeBudgetTracker } from "../budget/timeBudgetTracker";

export interface DecisionPipelineDependencies {
  strategyEngine: StrategyEngine;
  gtoSolver: GTOSolver;
  agentCoordinator?: AgentCoordinator;
  tracker?: TimeBudgetTracker;
  gtoBudgetMs?: number;
  logger?: Pick<Console, "debug" | "info" | "warn" | "error">;
}

export interface DecisionPipelineResult {
  decision: StrategyDecision;
  gtoSolution: GTOSolution;
  agentOutput: AggregatedAgentOutput;
  solverTimedOut: boolean;
}

const DEFAULT_GTO_BUDGET_MS = 400;

export async function makeDecision(
  state: GameState,
  sessionId: string,
  deps: DecisionPipelineDependencies
): Promise<DecisionPipelineResult> {
  const tracker = deps.tracker;
  let solverTimedOut = false;
  let gtoSolution: GTOSolution;
  let agentOutput: AggregatedAgentOutput;

  const shouldPreempt = tracker?.shouldPreempt?.("gto") ?? false;
  if (shouldPreempt) {
    solverTimedOut = true;
    gtoSolution = await deps.gtoSolver.solve(state, 0);
  } else {
    const defaultBudget = deps.gtoBudgetMs ?? DEFAULT_GTO_BUDGET_MS;
    const remaining = tracker?.remaining?.("gto") ?? defaultBudget;
    const requestedBudget = Math.max(0, Math.min(defaultBudget, remaining));
    const reserved = tracker?.reserve ? tracker.reserve("gto", requestedBudget) : true;
    if (!reserved || requestedBudget <= 0) {
      solverTimedOut = true;
      gtoSolution = await deps.gtoSolver.solve(state, 0);
    } else {
      tracker?.startComponent?.("gto");
      try {
        gtoSolution = await deps.gtoSolver.solve(state, requestedBudget);
      } finally {
        const actual = tracker?.endComponent?.("gto") ?? requestedBudget;
        if (tracker?.release && requestedBudget > actual) {
          tracker.release("gto", requestedBudget - actual);
        }
      }
    }
  }

  if (deps.agentCoordinator) {
    const context: PromptContext = {
      requestId: `decision-${state.handId}-${Date.now()}`,
      timeBudgetMs: 3000
    };
    const options: AgentQueryOptions = {
      budgetOverrideMs: context.timeBudgetMs
    };
    try {
      agentOutput = await deps.agentCoordinator.query(state, context, options);
    } catch (error) {
      deps.logger?.warn?.("Decision pipeline: agent coordinator query failed, using stub output", {
        error: error instanceof Error ? error.message : error
      });
      agentOutput = createStubAgentOutput();
    }
  } else {
    agentOutput = createStubAgentOutput();
  }

  const decision = deps.strategyEngine.decide(state, gtoSolution, agentOutput, sessionId);

  return {
    decision,
    gtoSolution,
    agentOutput,
    solverTimedOut
  };
}

export function createStubAgentOutput(): AggregatedAgentOutput {
  const now = Date.now();
  const normalizedActions: Map<ActionType, number> = new Map<ActionType, number>([
    ["fold", 0],
    ["check", 0],
    ["call", 0],
    ["raise", 0]
  ]);

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
