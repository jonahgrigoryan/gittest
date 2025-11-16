import type { Action, ActionKey } from "./types";
import type {
  SerializedProbabilityEntry,
  SerializedStrategyDecision,
  StrategyDecision,
  StrategyTimingBreakdown,
  ModelVersions
} from "./strategy";

export interface ReplayComparison {
  handId: string;
  sessionId: string;
  match: boolean;
  differences?: {
    action?: {
      original: Action;
      replayed: Action;
    };
    rngSeed?: {
      original: number;
      replayed: number;
    };
    blendedDistribution?: {
      original: SerializedProbabilityEntry[];
      replayed: SerializedProbabilityEntry[];
      /**
       * Total Variation distance expressed in percentage points.
       */
      divergence: number;
    };
    timing?: {
      original: StrategyTimingBreakdown;
      replayed: StrategyTimingBreakdown;
      delta: Partial<StrategyTimingBreakdown>;
    };
    modelVersions?: {
      logged?: ModelVersions;
      current?: ModelVersions;
      mismatches: string[];
    };
  };
  warnings: string[];
}

export interface ReplayResult {
  handId: string;
  sessionId: string;
  success: boolean;
  error?: string;
  comparison?: ReplayComparison;
  originalDecision: SerializedStrategyDecision;
  replayedDecision: StrategyDecision;
  timing: {
    replayMs: number;
    originalTotalMs: number;
    replayedTotalMs: number;
  };
}

export interface BatchReplayReport {
  sessionId: string;
  totalHands: number;
  successful: number;
  failed: number;
  matches: number;
  mismatches: number;
  errors: Array<{ handId: string; error: string }>;
  comparisons: ReplayComparison[];
  summary: {
    actionMatchRate: number;
    avgDivergence: number;
    p95Divergence: number;
    timingDelta: {
      gto: { mean: number; p95: number };
      agents: { mean: number; p95: number };
      total: { mean: number; p95: number };
    };
  };
  modelVersionWarnings: string[];
}
