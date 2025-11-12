import type { Action, ActionKey } from './types';

export interface StrategyConfig {
  alphaGTO: number;  // [0.3, 0.9] - GTO weight in blend
  betSizingSets: {
    preflop: number[];
    flop: number[];
    turn: number[];
    river: number[];
  };
  divergenceThresholdPP: number;  // Log when GTO vs agents differ >30pp
  rngSeed?: number;  // For deterministic replay
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
  riskSnapshot?: any;  // From risk controller
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
