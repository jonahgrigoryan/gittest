import type { AgentOutput, AggregatedCostSummary } from "../types";
import type { ActionType } from "@poker-bot/shared";

const MIN_CONFIDENCE = 0.05;

export function computeWeightedDistribution(
  outputs: AgentOutput[],
  weights: Map<string, number>
): Map<ActionType, number> {
  const distribution = new Map<ActionType, number>();
  let totalWeight = 0;

  for (const output of outputs) {
    const baseWeight = weights.get(output.agentId) ?? 0;
    const confidence = clampConfidence(output.confidence);
    const effectiveWeight = baseWeight * confidence;
    if (effectiveWeight <= 0) {
      continue;
    }
    totalWeight += effectiveWeight;
    distribution.set(output.action, (distribution.get(output.action) ?? 0) + effectiveWeight);
  }

  if (totalWeight <= 0) {
    return distribution;
  }

  for (const [action, value] of distribution.entries()) {
    distribution.set(action, value / totalWeight);
  }

  return distribution;
}

export function calculateConsensus(distribution: Map<ActionType, number>): number {
  const actionCount = distribution.size;
  if (actionCount === 0) {
    return 0;
  }

  let entropy = 0;
  for (const probability of distribution.values()) {
    if (probability > 0) {
      entropy -= probability * Math.log(probability);
    }
  }

  const maxEntropy = Math.log(actionCount);
  if (maxEntropy === 0) {
    return 1;
  }
  const normalized = 1 - entropy / maxEntropy;
  return Math.max(0, Math.min(1, normalized));
}

export function determineWinningAction(distribution: Map<ActionType, number>): ActionType | null {
  let bestAction: ActionType | null = null;
  let bestScore = -Infinity;
  for (const [action, probability] of distribution.entries()) {
    if (probability > bestScore) {
      bestScore = probability;
      bestAction = action;
    }
  }
  return bestAction;
}

export function buildCostSummary(outputs: AgentOutput[]): AggregatedCostSummary {
  const summary: AggregatedCostSummary = {
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalCostUsd: 0
  };

  for (const output of outputs) {
    summary.promptTokens += output.tokenUsage.promptTokens;
    summary.completionTokens += output.tokenUsage.completionTokens;
    summary.totalTokens += output.tokenUsage.totalTokens;
    summary.totalCostUsd! += output.costUsd ?? 0;
  }

  if (summary.totalCostUsd === 0) {
    delete summary.totalCostUsd;
  }

  return summary;
}

function clampConfidence(confidence: number): number {
  if (!Number.isFinite(confidence) || confidence <= 0) {
    return MIN_CONFIDENCE;
  }
  return Math.max(MIN_CONFIDENCE, Math.min(1, confidence));
}
