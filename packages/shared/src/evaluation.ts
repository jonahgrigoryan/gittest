import { randomUUID } from "node:crypto";

export type EvaluationMode =
  | "offline_smoke"
  | "offline_full"
  | "shadow"
  | "ab_test";

export interface OpponentProfile {
  id: string;
  label: string;
  description?: string;
  style: "tight_aggressive" | "loose_passive" | "mixed_gto" | "baseline_proxy";
  aggressionFactor: number;
  bluffFrequency: number;
}

export interface EvaluationRunConfig {
  mode: EvaluationMode;
  opponents: string[];
  maxHands: number;
  maxHandsPerOpponent?: number;
  seed?: number;
  targetWinRateBb100?: number;
  maxExploitability?: number;
  notes?: string;
}

export interface HandMetric {
  handId: string;
  opponentId: string;
  netChips: number;
  bigBlind: number;
  decisionLatencyMs?: number;
  exploitabilityDelta?: number;
}

export interface EvaluationAggregateReport {
  runId: string;
  mode: EvaluationMode;
  opponents: string[];
  totalHands: number;
  winRateBb100: number;
  winRateConfidenceInterval: [number, number];
  exploitabilityEstimate?: number;
  startedAt: number;
  completedAt: number;
  config: EvaluationRunConfig;
  metricsPath: string;
}

export interface WinRateStats {
  meanBb100: number;
  lower95: number;
  upper95: number;
}

export interface EvaluationRunMetadata {
  runId: string;
  mode: EvaluationMode;
  opponentId?: string;
}

export function computeWinRateStats(metrics: HandMetric[]): WinRateStats {
  if (!metrics.length) {
    return { meanBb100: 0, lower95: 0, upper95: 0 };
  }
  const values = metrics.map(metric => (metric.netChips / Math.max(metric.bigBlind, 1)) * 100);
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + (val - mean) ** 2, 0) / Math.max(values.length - 1, 1);
  const stdErr = Math.sqrt(variance / values.length);
  const margin = 1.96 * stdErr;
  return {
    meanBb100: mean,
    lower95: mean - margin,
    upper95: mean + margin
  };
}

export function createEvaluationReport(
  config: EvaluationRunConfig,
  metrics: HandMetric[],
  options: { metricsPath: string; startedAt: number; completedAt?: number; runId?: string }
): EvaluationAggregateReport {
  const stats = computeWinRateStats(metrics);
  return {
    runId: options.runId ?? randomUUID(),
    mode: config.mode,
    opponents: config.opponents,
    totalHands: metrics.length,
    winRateBb100: stats.meanBb100,
    winRateConfidenceInterval: [stats.lower95, stats.upper95],
    startedAt: options.startedAt,
    completedAt: options.completedAt ?? Date.now(),
    config,
    metricsPath: options.metricsPath
  };
}
