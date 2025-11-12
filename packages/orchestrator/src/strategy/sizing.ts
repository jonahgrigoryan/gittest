import type { Action, GameState, Street } from "@poker-bot/shared";
import type { StrategyConfig } from "@poker-bot/shared";

/**
 * BetSizer quantizes raises to configured pot-fraction sets while respecting
 * legal actions and stack limits. It never calls SafeAction directly; callers
 * must handle invalid results.
 */
export class BetSizer {
  private readonly config: StrategyConfig;

  constructor(config: StrategyConfig) {
    this.config = config;
  }

  /**
   * Result type for sizing decisions so callers can distinguish hard failures.
   */
  quantizeBetSize(
    action: Action,
    state: GameState
  ): { ok: true; action: Action } | { ok: false; reason: string } {
    if (action.type !== "raise") {
      // Non-raise actions pass through unchanged.
      return { ok: true, action };
    }

    const legal = state.legalActions ?? [];
    if (legal.length === 0) {
      return {
        ok: false,
        reason: "no_legal_actions"
      };
    }

    const raiseLegals = legal.filter(a => a.type === "raise" && typeof a.amount === "number");
    if (raiseLegals.length === 0) {
      // No legal raises; let caller decide fallback (SafeAction/GTO-only).
      return {
        ok: false,
        reason: "no_legal_raises"
      };
    }

    const streetSet = this.getStreetSizingSet(state.street);
    if (!streetSet || streetSet.length === 0) {
      // No configured sizing set; clamp to nearest legal using provided amount.
      const nearest = this.chooseNearestLegalRaise(raiseLegals, action.amount);
      if (!Number.isFinite(nearest)) {
        return {
          ok: false,
          reason: "no_legal_raise_match_without_sizing_set"
        };
      }
      return {
        ok: true,
        action: { ...action, amount: nearest }
      };
    }

    const pot = this.getEffectivePot(state);
    const toCall = this.getCallAmount(state);
    const targetFraction = this.deriveTargetFraction(action, pot, toCall);
    const nearestFraction = this.findNearestFraction(targetFraction, streetSet);

    const total = pot + toCall;
    if (total <= 0 || !Number.isFinite(nearestFraction) || nearestFraction < 0) {
      return {
        ok: false,
        reason: "invalid_base_for_sizing"
      };
    }

    const rawAmount = nearestFraction * total;
    const heroStack = this.getHeroStack(state);
    const minBet = Math.min(...raiseLegals.map(a => a.amount as number));
    const maxBet = Math.max(...raiseLegals.map(a => a.amount as number));

    const clamped = this.clampToLimits(rawAmount, minBet, maxBet, heroStack);
    if (!Number.isFinite(clamped) || clamped < minBet) {
      return {
        ok: false,
        reason: "failed_to_clamp_sizing"
      };
    }

    const snapped = this.snapToNearestLegal(raiseLegals, clamped);
    if (!Number.isFinite(snapped) || snapped < minBet) {
      return {
        ok: false,
        reason: "failed_to_snap_to_legal_raise"
      };
    }

    return {
      ok: true,
      action: {
        ...action,
        amount: snapped
      }
    };
  }

  /**
   * Select the configured bet sizing set for a street.
   */
  private getStreetSizingSet(street: Street): number[] | undefined {
    const sets = this.config.betSizingSets;
    if (!sets) return undefined;
    switch (street) {
      case "preflop":
        return sets.preflop;
      case "flop":
        return sets.flop;
      case "turn":
        return sets.turn;
      case "river":
        return sets.river;
      default:
        return undefined;
    }
  }

  /**
   * Compute the effective pot size from GameState.
   */
  private getEffectivePot(state: GameState): number {
    const pot = typeof state.pot === "number" && Number.isFinite(state.pot) ? state.pot : 0;
    return Math.max(0, pot);
  }

  /**
   * Determine the amount required to call from legalActions.
   */
  private getCallAmount(state: GameState): number {
    const call = (state.legalActions ?? []).find(a => a.type === "call");
    if (!call || typeof call.amount !== "number" || !Number.isFinite(call.amount)) {
      return 0;
    }
    return Math.max(0, call.amount);
  }

  /**
   * Derive the target pot fraction from an input action.
   * If the input has an amount, interpret it as a fraction of (pot + toCall).
   * Otherwise, default to the middle of configured range.
   */
  private deriveTargetFraction(action: Action, pot: number, toCall: number): number {
    if (action.amount && action.amount > 0 && pot + toCall > 0) {
      return this.safeDivide(action.amount, pot + toCall);
    }

    const sets = this.config.betSizingSets;
    const all =
      sets?.preflop && sets?.flop && sets?.turn && sets?.river
        ? [...sets.preflop, ...sets.flop, ...sets.turn, ...sets.river]
        : [];
    if (all.length > 0) {
      const sorted = [...all].sort((a, b) => a - b);
      const mid = sorted[Math.floor(sorted.length / 2)];
      return mid;
    }

    return 1.0;
  }

  /**
   * Find the nearest fraction in a sorted array.
   */
  findNearestFraction(target: number, available: number[]): number {
    if (available.length === 0) return target;
    let best = available[0];
    let bestDiff = Math.abs(best - target);
    for (let i = 1; i < available.length; i++) {
      const diff = Math.abs(available[i] - target);
      if (diff < bestDiff) {
        best = available[i];
        bestDiff = diff;
      }
    }
    return best;
  }

  /**
   * Clamp a bet amount to min/max/stack constraints.
   */
  clampToLimits(amount: number, minBet: number, maxBet: number, stack: number): number {
    const finiteAmount = Number.isFinite(amount) ? amount : minBet;
    let result = finiteAmount;
    if (result < minBet) result = minBet;
    if (result > maxBet) result = maxBet;
    if (result > stack) result = stack;
    return Math.max(minBet, Math.min(result, maxBet));
  }

  /**
   * Choose the legal raise amount closest to a target.
   */
  private snapToNearestLegal(raises: Action[], target: number): number {
    let best = raises[0].amount as number;
    let bestDiff = Math.abs(best - target);
    for (let i = 1; i < raises.length; i++) {
      const amt = raises[i].amount as number;
      const diff = Math.abs(amt - target);
      if (diff < bestDiff) {
        best = amt;
        bestDiff = diff;
      }
    }
    return best;
  }

  /**
   * If an explicit amount is provided but there is no sizing set,
   * pick the nearest legal raise.
   */
  private chooseNearestLegalRaise(raises: Action[], amount?: number): number {
    if (!amount || amount <= 0) {
      return raises[0].amount as number;
    }
    return this.snapToNearestLegal(raises, amount);
  }

  private getHeroStack(state: GameState): number {
    const heroPos = state.positions.hero;
    const hero = state.players.get(heroPos);
    if (!hero || !Number.isFinite(hero.stack)) {
      return Number.MAX_SAFE_INTEGER;
    }
    return Math.max(0, hero.stack);
  }

  private safeDivide(num: number, den: number): number {
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
    return num / den;
  }
}
