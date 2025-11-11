import type { Action, ActionKey, GameState, GTOSolution } from "@poker-bot/shared";
import type { AggregatedAgentOutput } from "@poker-bot/agents";
import type {
  RiskCheckOptions,
  RiskCheckResult,
  RiskSnapshot,
  RiskGuardAPI as RiskController
} from "../safety/types";
import type { TimeBudgetTracker } from "../budget/timeBudgetTracker";

export interface StrategyConfigBetSizingSets {
  preflop: number[];
  flop: number[];
  turn: number[];
  river: number[];
}

export interface StrategyConfig {
  alphaGTO: number;
  betSizingSets: StrategyConfigBetSizingSets;
  divergenceThresholdPP: number;
  rngSeed?: number;
  opponentModeling?: {
    enabled: boolean;
    minHands: number;
  };
}

export interface BlendedDistribution {
  actions: Map<ActionKey, number>;
  alpha: number;
  gtoWeight: number;
  agentWeight: number;
}

export interface StrategyReasoningTrace {
  gtoRecommendation: Map<ActionKey, number>;
  agentRecommendation: Map<ActionKey, number>;
  blendedDistribution: Map<ActionKey, number>;
  alpha: number;
  divergence: number;
  riskCheckPassed: boolean;
  sizingQuantized: boolean;
  fallbackReason?: string;
  panicStop?: boolean;
}

export interface StrategyTimingBreakdown {
  gtoTime: number;
  agentTime: number;
  synthesisTime: number;
  totalTime: number;
}

export interface StrategyMetadata {
  rngSeed: number;
  configSnapshot: StrategyConfig;
  riskSnapshot?: RiskSnapshot;
  modelHashes?: Record<string, string>;
  preempted?: boolean;
  usedGtoOnlyFallback?: boolean;
  panicStop?: boolean;
}

export interface StrategyDecision {
  action: Action;
  reasoning: StrategyReasoningTrace;
  timing: StrategyTimingBreakdown;
  metadata: StrategyMetadata;
}

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
