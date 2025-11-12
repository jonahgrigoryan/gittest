import type { Action, Position, Street } from "@poker-bot/shared";
import type { StrategyConfig } from "@poker-bot/shared";

/**
 * Opponent modeling scaffold (Task 8.6).
 *
 * This module is intentionally bounded and side-effect free:
 * - Enabled via config flag (strategy.opponentModeling.enabled), default false.
 * - Collects simple frequency stats per position and street.
 * - StrategyEngine can optionally use these stats to slightly adjust distributions.
 */
export interface PositionStatsBucket {
  count: number;
  frequency: number;
}

export interface PositionStats {
  vpip: PositionStatsBucket;
  pfr: PositionStatsBucket;
  threeBet: PositionStatsBucket;
  foldToCbet: PositionStatsBucket;
  checkRaise: PositionStatsBucket;
}

export class OpponentModeler {
  private readonly enabled: boolean;
  private readonly minSamples: number;

  // position -> statKey -> bucket
  private readonly store: Map<Position, PositionStats>;

  constructor(config: StrategyConfig) {
    const cfg = (config as any).opponentModeling ?? {};
    this.enabled = cfg.enabled === true;
    this.minSamples = typeof cfg.minHands === "number" && cfg.minHands > 0 ? cfg.minHands : 100;
    this.store = new Map();
  }

  /**
   * Record an observed opponent action for modeling purposes.
   * No effect when disabled.
   */
  recordAction(position: Position, action: Action, street: Street): void {
    if (!this.enabled) return;

    const stats = this.getOrCreate(position);

    // VPIP: voluntarily put money in pot (non-fold preflop actions with chips invested).
    if (street === "preflop" && (action.type === "call" || action.type === "raise")) {
      this.bump(stats.vpip);
    }

    // PFR: preflop raise.
    if (street === "preflop" && action.type === "raise") {
      this.bump(stats.pfr);
    }

    // Simple 3-bet heuristic: treat later-street raises as aggressive bucket.
    if (action.type === "raise") {
      this.bump(stats.threeBet);
    }

    // Check-raise / fold-to-cbet / other nuanced stats would require contextual
    // tracking across multiple actions. Here we only scaffold buckets to be
    // filled by future tasks; they remain inert unless explicitly updated.
  }

  /**
   * Return stats for a given position if sufficient samples exist.
   * Otherwise returns undefined so callers can ignore modeling.
   */
  getPositionStats(position: Position): PositionStats | undefined {
    if (!this.enabled) return undefined;
    const stats = this.store.get(position);
    if (!stats) return undefined;

    const totalSamples =
      stats.vpip.count +
      stats.pfr.count +
      stats.threeBet.count +
      stats.foldToCbet.count +
      stats.checkRaise.count;

    if (totalSamples < this.minSamples) {
      return undefined;
    }

    return stats;
  }

  /**
   * Adjust a distribution based on opponent tendencies.
   * This helper is intentionally conservative; callers must decide whether
   * to use it based on config and available stats.
   */
  adjustDistributionForPosition(
    position: Position,
    dist: Map<string, number>
  ): Map<string, number> {
    if (!this.enabled) return dist;
    const stats = this.getPositionStats(position);
    if (!stats) return dist;

    // Example bounded adjustment:
    // - If VPIP is very high, slightly up-weight aggressive actions.
    // - If VPIP is very low, slightly up-weight folds.
    const vpip = stats.vpip.frequency;
    const factorFold = vpip < 0.15 ? 1.05 : 1.0;
    const factorAgg = vpip > 0.35 ? 1.05 : 1.0;

    if (factorFold === 1.0 && factorAgg === 1.0) {
      return dist;
    }

    const adjusted = new Map<string, number>();
    let total = 0;

    for (const [key, p] of dist.entries()) {
      let weight = p;
      const lower = key.toLowerCase();
      if (lower.includes("fold")) {
        weight *= factorFold;
      } else if (lower.includes("raise")) {
        weight *= factorAgg;
      }
      if (weight > 0 && Number.isFinite(weight)) {
        adjusted.set(key, weight);
        total += weight;
      }
    }

    if (total <= 0) {
      return dist;
    }

    // Normalize adjusted distribution.
    for (const [key, p] of adjusted.entries()) {
      adjusted.set(key, p / total);
    }

    return adjusted;
  }

  private getOrCreate(position: Position): PositionStats {
    let stats = this.store.get(position);
    if (!stats) {
      stats = {
        vpip: { count: 0, frequency: 0 },
        pfr: { count: 0, frequency: 0 },
        threeBet: { count: 0, frequency: 0 },
        foldToCbet: { count: 0, frequency: 0 },
        checkRaise: { count: 0, frequency: 0 }
      };
      this.store.set(position, stats);
    }
    return stats;
  }

  private bump(bucket: PositionStatsBucket): void {
    bucket.count += 1;
    // frequency will be normalized lazily by consumers based on total samples;
    // for simplicity we treat it as a running proportion here.
    // In a more advanced implementation, we'd track separate totals.
    bucket.frequency = bucket.frequency + (1 - bucket.frequency) / bucket.count;
  }
}
