/**
 * Simple deterministic RNG helper for executor-side jitter so replays
 * stay identical for a given StrategyDecision metadata.rngSeed.
 */
export function deterministicRandom(seed: number, offset: number): number {
  const base = (seed >>> 0) + (offset >>> 0);
  const next = (Math.imul(base ^ 0x45d9f3b, 1664525) + 1013904223) >>> 0;
  return next / 0x100000000;
}
