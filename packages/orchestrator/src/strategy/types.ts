import type { Action, ActionKey, GameState, GTOSolution } from "@poker-bot/shared";
import type { AggregatedAgentOutput } from "@poker-bot/agents";
import type {
  RiskCheckOptions,
  RiskCheckResult,
  RiskSnapshot,
  RiskGuardAPI as RiskController
} from "../safety/types";
import type { TimeBudgetTracker } from "../budget/timeBudgetTracker";

// Re-export strategy types from shared package
export type {
  StrategyConfig,
  BlendedDistribution,
  StrategyReasoningTrace,
  StrategyTimingBreakdown,
  StrategyMetadata,
  StrategyDecision
} from "@poker-bot/shared";

export interface StrategyEngineDeps {
  logger?: Pick<Console, "debug" | "info" | "warn" | "error">;
  timeBudgetTracker?: TimeBudgetTracker;
}

export interface StrategyInputs {
  state: GameState;
  gto: GTOSolution;
  agents: AggregatedAgentOutput;
  gtoTimeMs?: number;
  agentTimeMs?: number;
}

export type RNG = {
  next(): number;
};

export interface DivergenceLogEntry {
  type: "strategy_divergence";
  handId: string;
  divergence: number;
  threshold: number;
  gtoTopActions: Array<{ action: ActionKey; prob: number }>;
  agentTopActions: Array<{ action: ActionKey; prob: number }>;
  alpha: number;
  rngSeed: number;
  modelHashes: Record<string, string>;
}
