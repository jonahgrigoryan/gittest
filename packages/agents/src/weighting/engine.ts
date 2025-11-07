import type { AgentOutput, WeightSnapshot, WeightSnapshotEntry, BrierSample } from "../types";

const CURRENT_VERSION = 1;
const DEFAULT_DECAY = 0.8;
const MIN_ERROR = 0.001;
const MAX_ERROR = 1;
const FULL_WEIGHT_SAMPLE_THRESHOLD = 10;

export function createDefaultSnapshot(): WeightSnapshot {
  return {
    version: CURRENT_VERSION,
    updatedAt: Date.now(),
    decayFactor: DEFAULT_DECAY,
    defaultWeight: 1,
    entries: {}
  };
}

export function computeWeights(outputs: AgentOutput[], snapshot: WeightSnapshot): Map<string, number> {
  const weights = new Map<string, number>();

  for (const output of outputs) {
    const entry = snapshot.entries[output.agentId];
    const historicalWeight = entry?.weight ?? snapshot.defaultWeight;
    const sampleRatio = entry ? Math.min(1, entry.sampleCount / FULL_WEIGHT_SAMPLE_THRESHOLD) : 0;
    const blendedWeight = snapshot.defaultWeight * (1 - sampleRatio) + historicalWeight * sampleRatio;
    weights.set(output.agentId, blendedWeight);
  }

  return weights;
}

export function updateWeightSnapshot(snapshot: WeightSnapshot, samples: BrierSample[]): WeightSnapshot {
  if (samples.length === 0) {
    return snapshot;
  }

  const entries: Record<string, WeightSnapshotEntry> = { ...snapshot.entries };
  const now = Date.now();

  for (const sample of samples) {
    const entry = entries[sample.agentId]
      ? { ...entries[sample.agentId] }
      : initializeEntry(sample.agentId, sample.personaId ?? "", snapshot.defaultWeight);
    const error = clampError((sample.predicted - sample.outcome) ** 2);
    const weightFactor = sample.weight ?? 1;

    entry.brierScore = entry.sampleCount === 0
      ? error
      : entry.brierScore * snapshot.decayFactor + error * (1 - snapshot.decayFactor);
    entry.sampleCount += weightFactor;
    entry.weight = calculateWeight(entry.brierScore);
    entry.updatedAt = now;
    entry.agentId = sample.agentId;
    entries[sample.agentId] = entry;
  }

  return {
    ...snapshot,
    entries,
    updatedAt: now
  };
}

function initializeEntry(agentId: string, personaId: string, defaultWeight: number): WeightSnapshotEntry {
  return {
    agentId,
    personaId,
    weight: defaultWeight,
    brierScore: 0.25,
    sampleCount: 0,
    updatedAt: Date.now()
  } as WeightSnapshotEntry;
}

function calculateWeight(brierScore: number): number {
  const boundedScore = clampError(brierScore);
  return 1 / (1 + boundedScore);
}

function clampError(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return MIN_ERROR;
  }
  return Math.min(MAX_ERROR, Math.max(MIN_ERROR, value));
}
