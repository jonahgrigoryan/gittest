import type { ActionKey } from "@poker-bot/shared/src/types";
import type { DivergenceLogEntry } from "./types";
import type { StrategyConfig } from "@poker-bot/shared/src/strategy";

export class DivergenceDetector {
  private readonly thresholdPP: number;
  private readonly logger?: Pick<Console, "debug" | "info" | "warn" | "error">;

  constructor(config: StrategyConfig, logger?: Pick<Console, "debug" | "info" | "warn" | "error">) {
    this.thresholdPP = config.divergenceThresholdPP ?? 30;
    this.logger = logger;
  }

  /**
   * Compute total variation distance between two distributions in percentage points.
   * Expects normalized maps, but will self-normalize defensively.
   */
  computeDivergence(
    dist1: Map<ActionKey, number>,
    dist2: Map<ActionKey, number>
  ): number {
    const a = this.normalize(dist1);
    const b = this.normalize(dist2);

    const keys = new Set<ActionKey>([...a.keys(), ...b.keys()]);
    let tvd = 0;
    for (const k of keys) {
      const p = a.get(k) ?? 0;
      const q = b.get(k) ?? 0;
      tvd += Math.abs(p - q);
    }
    tvd /= 2;
    return Math.max(0, Math.min(1, tvd)) * 100;
  }

  shouldLogDivergence(divergencePP: number): boolean {
    return divergencePP > this.thresholdPP;
  }

  /**
   * Build structured divergence log entry capturing top-3 actions from each distribution.
   * Callers can enrich with model hashes and other metadata.
   */
  formatDivergenceLog(params: {
    handId: string;
    gto: Map<ActionKey, number>;
    agent: Map<ActionKey, number>;
    divergencePP: number;
    alpha: number;
    rngSeed: number;
    modelHashes?: Record<string, string>;
  }): DivergenceLogEntry {
    const { handId, gto, agent, divergencePP, alpha, rngSeed, modelHashes = {} } = params;

    const gtoTop = this.topActions(gto, 3);
    const agentTop = this.topActions(agent, 3);

    return {
      type: "strategy_divergence",
      handId,
      divergence: divergencePP,
      threshold: this.thresholdPP,
      gtoTopActions: gtoTop,
      agentTopActions: agentTop,
      alpha,
      rngSeed,
      modelHashes
    };
  }

  logIfNeeded(
    handId: string,
    gto: Map<ActionKey, number>,
    agent: Map<ActionKey, number>,
    alpha: number,
    rngSeed: number,
    modelHashes?: Record<string, string>
  ): number {
    const divergencePP = this.computeDivergence(gto, agent);
    if (!this.logger || !this.shouldLogDivergence(divergencePP)) {
      return divergencePP;
    }

    const entry = this.formatDivergenceLog({
      handId,
      gto,
      agent,
      divergencePP,
      alpha,
      rngSeed,
      modelHashes
    });

    this.logger.info?.("StrategyEngine: divergence detected", entry);
    return divergencePP;
  }

  private normalize(dist: Map<ActionKey, number>): Map<ActionKey, number> {
    let total = 0;
    for (const v of dist.values()) {
      if (Number.isFinite(v) && v > 0) total += v;
    }
    if (total <= 0) {
      return new Map();
    }
    const out = new Map<ActionKey, number>();
    for (const [k, v] of dist.entries()) {
      if (!Number.isFinite(v) || v <= 0) continue;
      out.set(k, v / total);
    }
    return out;
  }

  private topActions(
    dist: Map<ActionKey, number>,
    limit: number
  ): Array<{ action: ActionKey; prob: number }> {
    return [...dist.entries()]
      .map(([action, prob]) => ({ action, prob }))
      .sort((a, b) => b.prob - a.prob)
      .slice(0, limit);
  }
}
