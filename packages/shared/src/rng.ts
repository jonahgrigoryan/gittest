/**
 * Shared RNG helpers for deterministic replay.
 *
 * Seeds are derived from the tuple (handId, sessionId) using a fast 32-bit
 * FNV-1a hash so every component can reproduce the exact sequence of random
 * numbers that StrategyEngine used for a given hand.
 */
export function generateRngSeed(handId: string, sessionId: string): number {
  const normalizedHand = handId ?? "unknown-hand";
  const normalizedSession = sessionId ?? "unknown-session";
  const input = `${normalizedHand}:${normalizedSession}`;
  let hash = 0x811c9dc5; // FNV offset basis

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

/**
 * Validate that a numeric seed falls within the acceptable 32-bit range.
 */
export function validateSeed(seed: number): boolean {
  return Number.isFinite(seed) && seed >= 0 && seed <= 0xffffffff;
}
