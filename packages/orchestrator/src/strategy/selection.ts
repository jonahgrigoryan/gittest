import type { Action, ActionKey, GameState, RNG } from "@poker-bot/shared/src/types";
import type { StrategyConfig } from "@poker-bot/shared/src/strategy";
import { generateRngSeed, validateSeed } from "@poker-bot/shared/src/rng";
import { decodeAndValidateActionKey, type ParsedActionKeyResult } from "./util";

/**
 * Deterministic RNG using a simple LCG for reproducibility.
 */
export class SeededRNG implements RNG {
  seed: number;
  readonly initialSeed: number;

  constructor(seed: number) {
    if (!validateSeed(seed)) {
      throw new Error("SeededRNG: seed must be a finite number");
    }
    this.seed = seed >>> 0;
    this.initialSeed = this.seed;
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
  createRNG(handId: string, sessionId: string, extra?: number): RNG {
    if (Number.isFinite(this.baseSeed!)) {
      return new SeededRNG(this.baseSeed as number);
    }
    if (!handId) {
      throw new Error("ActionSelector.createRNG requires a handId");
    }
    const derivedSeed = generateRngSeed(handId, sessionId);
    const finalSeed = typeof extra === "number" ? (derivedSeed + extra) >>> 0 : derivedSeed;
    return new SeededRNG(finalSeed);
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

}

/**
 * Utility to derive per-decision RNG seed from config/state.
 */
export function deriveRngForDecision(
  selector: ActionSelector,
  config: StrategyConfig,
  params: { state: GameState; sessionId: string; seedOverride?: number }
): RNG {
  if (typeof params.seedOverride === "number") {
    return new SeededRNG(params.seedOverride);
  }
  if (config.rngSeed !== undefined) {
    return new SeededRNG(config.rngSeed);
  }
  return selector.createRNG(params.state.handId, params.sessionId);
}
