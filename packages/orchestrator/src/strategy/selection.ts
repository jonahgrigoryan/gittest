import type { Action, ActionKey, GameState } from "@poker-bot/shared";
import type { RNG, StrategyConfig } from "./types";
import { decodeAndValidateActionKey, type ParsedActionKeyResult } from "./util";

/**
 * Deterministic RNG using a simple LCG for reproducibility.
 */
export class SeededRNG implements RNG {
  private seed: number;

  constructor(seed: number) {
    if (!Number.isFinite(seed)) {
      throw new Error("SeededRNG: seed must be a finite number");
    }
    this.seed = seed >>> 0;
  }

  next(): number {
    // LCG parameters from Numerical Recipes
    this.seed = (this.seed * 1664525 + 1013904223) % 0x100000000;
    return this.seed / 0x100000000;
  }
}

export class ActionSelector {
  private readonly baseSeed?: number;

  constructor(rngSeed?: number) {
    this.baseSeed = rngSeed;
  }

  /**
   * Create a deterministic RNG instance.
   * If an explicit seed is provided, use it; otherwise derive from handId+timestamp.
   */
  createRNG(handId?: string, extra?: number): RNG {
    if (Number.isFinite(this.baseSeed!)) {
      return new SeededRNG(this.baseSeed as number);
    }
    const hashInput = `${handId ?? "unknown"}:${extra ?? Date.now()}`;
    const seed = this.hashStringToSeed(hashInput);
    return new SeededRNG(seed);
  }

  /**
   * Select an ActionKey from a probability distribution using RNG.
   * Returns a discriminated result instead of throwing so callers can
   * route through centralized fallbacks.
   */
  selectAction(distribution: Map<ActionKey, number>, rng: RNG): ParsedActionKeyResult {
    const normalized = this.normalize(distribution);
    if (normalized.size === 0) {
      return {
        ok: false,
        key: "",
        reason: "empty_distribution"
      };
    }

    const r = rng.next();
    let cumulative = 0;
    let chosenKey: ActionKey | null = null;

    for (const [key, p] of normalized.entries()) {
      cumulative += p;
      if (r <= cumulative + 1e-12) {
        chosenKey = key;
        break;
      }
    }

    if (!chosenKey) {
      // Numerical fallback: use last key
      for (const key of normalized.keys()) {
        chosenKey = key;
      }
    }

    if (!chosenKey) {
      return {
        ok: false,
        key: "",
        reason: "no_key_selected"
      };
    }

    return {
      ok: true,
      key: chosenKey,
      // action is resolved later via decodeAndValidateActionKey by the engine
      // to keep this selector focused on sampling.
      action: undefined as unknown as Action
    };
  }

  /**
   * End-to-end helper: sample ActionKey and decode+validate into an Action.
   * Returns discriminated result instead of throwing.
   */
  selectActionForState(
    distribution: Map<ActionKey, number>,
    state: GameState,
    rng: RNG
  ): ParsedActionKeyResult {
    const picked = this.selectAction(distribution, rng);
    if (!picked.ok || !picked.key) {
      return picked;
    }
    return decodeAndValidateActionKey(picked.key, state);
  }

  private normalize(dist: Map<ActionKey, number>): Map<ActionKey, number> {
    let total = 0;
    for (const v of dist.values()) {
      if (Number.isFinite(v) && v > 0) total += v;
    }
    if (total <= 0) {
      return new Map();
    }
    const normalized = new Map<ActionKey, number>();
    for (const [k, v] of dist.entries()) {
      if (!Number.isFinite(v) || v <= 0) continue;
      normalized.set(k, v / total);
    }
    return normalized;
  }

  private hashStringToSeed(input: string): number {
    let hash = 2166136261 >>> 0; // FNV-1a basis
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

}

/**
 * Utility to derive per-decision RNG seed from config/state.
 */
export function deriveRngForDecision(
  selector: ActionSelector,
  config: StrategyConfig,
  state: GameState
): RNG {
  if (config.rngSeed !== undefined) {
    return new SeededRNG(config.rngSeed);
  }
  return selector.createRNG(state.handId);
}
