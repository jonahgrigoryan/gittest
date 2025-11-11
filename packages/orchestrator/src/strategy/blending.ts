import type { ActionKey } from "@poker-bot/shared";
import type { GTOSolution } from "@poker-bot/shared";
import type { AggregatedAgentOutput } from "@poker-bot/agents";
import type { BlendedDistribution, StrategyConfig } from "./types";

const MIN_ALPHA = 0.3;
const MAX_ALPHA = 0.9;

export class StrategyBlender {
  private alpha: number;
  private readonly logger?: Pick<Console, "debug" | "info" | "warn" | "error">;

  constructor(private readonly config: StrategyConfig, logger?: Pick<Console, "debug" | "info" | "warn" | "error">) {
    const initialAlpha = typeof config.alphaGTO === "number" ? config.alphaGTO : 0.6;
    this.alpha = this.clampAlpha(initialAlpha);
    this.logger = logger;
  }

  blend(gtoSolution: GTOSolution, agentOutput: AggregatedAgentOutput): BlendedDistribution {
    const gtoDist = this.extractGtoDistribution(gtoSolution);
    const agentDist = this.extractAgentDistribution(agentOutput, gtoDist);

    const { gto: gtoWeight, agent: agentWeight } = this.computeWeights(this.alpha);

    const blended = new Map<ActionKey, number>();
    const allKeys = new Set<ActionKey>([...gtoDist.keys(), ...agentDist.keys()]);

    for (const key of allKeys) {
      const gtoP = gtoDist.get(key) ?? 0;
      const agentP = agentDist.get(key) ?? 0;
      const value = gtoWeight * gtoP + agentWeight * agentP;
      if (!Number.isFinite(value) || value < 0) {
        continue;
      }
      blended.set(key, value);
    }

    const normalized = this.normalize(blended);
    if (normalized.size === 0) {
      this.logger?.warn?.("StrategyBlender: empty blended distribution, falling back to pure GTO");
      const fallback = this.normalize(gtoDist);
      return {
        actions: fallback,
        alpha: 1.0,
        gtoWeight: 1.0,
        agentWeight: 0.0
      };
    }

    return {
      actions: normalized,
      alpha: this.alpha,
      gtoWeight,
      agentWeight
    };
  }

  setAlpha(alpha: number): boolean {
    if (!this.validateAlpha(alpha)) {
      this.logger?.warn?.("StrategyBlender: attempted to set invalid alpha", { alpha });
      return false;
    }
    this.alpha = this.clampAlpha(alpha);
    this.logger?.info?.("StrategyBlender: alpha updated", { alpha: this.alpha });
    return true;
  }

  getCurrentAlpha(): number {
    return this.alpha;
  }

  validateAlpha(alpha: number): boolean {
    return Number.isFinite(alpha) && alpha >= MIN_ALPHA && alpha <= MAX_ALPHA;
  }

  computeWeights(alpha: number): { gto: number; agent: number } {
    const clamped = this.clampAlpha(alpha);
    return {
      gto: clamped,
      agent: 1 - clamped
    };
  }

  private clampAlpha(alpha: number): number {
    if (!Number.isFinite(alpha)) {
      return 0.6;
    }
    return Math.max(MIN_ALPHA, Math.min(MAX_ALPHA, alpha));
  }

  private extractGtoDistribution(gtoSolution: GTOSolution): Map<ActionKey, number> {
    const result = new Map<ActionKey, number>();
    if (!gtoSolution || !gtoSolution.actions) {
      return result;
    }

    // GTOSolution.actions: Map<ActionKey, ActionSolutionEntry>
    for (const [key, entry] of gtoSolution.actions.entries()) {
      const freq = entry?.solution?.frequency;
      const p = typeof freq === "number" ? freq : 0;
      if (p > 0 && Number.isFinite(p)) {
        result.set(key as ActionKey, p);
      }
    }

    // Normalize because solver frequencies may not be perfectly normalized.
    return this.normalize(result);
  }

  private extractAgentDistribution(
    agentOutput: AggregatedAgentOutput,
    gtoDist: Map<ActionKey, number>
  ): Map<ActionKey, number> {
    const mapped = new Map<ActionKey, number>();

    if (!agentOutput || !(agentOutput.normalizedActions instanceof Map)) {
      return mapped;
    }

    // Group GTO keys by coarse action type for mapping.
    const byType: Record<string, ActionKey[]> = {
      fold: [],
      check: [],
      call: [],
      raise: []
    };

    for (const key of gtoDist.keys()) {
      const actionType = this.inferActionTypeFromKey(key);
      if (byType[actionType]) {
        byType[actionType].push(key);
      }
    }

    for (const [actionType, prob] of agentOutput.normalizedActions.entries()) {
      if (!Number.isFinite(prob) || prob <= 0) continue;
      const keys = byType[actionType];
      if (!keys || keys.length === 0) {
        // No matching legal keys for this action type in GTO; leave handling to fallbacks.
        continue;
      }

      if (actionType === "raise" && keys.length > 1) {
        // Distribute raise probability proportionally to existing GTO raise weights if present, otherwise evenly.
        const gtoMass = keys.reduce((sum, k) => sum + (gtoDist.get(k) ?? 0), 0);
        if (gtoMass > 0) {
          for (const key of keys) {
            const base = gtoDist.get(key) ?? 0;
            const portion = (base / gtoMass) * prob;
            mapped.set(key, (mapped.get(key) ?? 0) + portion);
          }
        } else {
          const portion = prob / keys.length;
          for (const key of keys) {
            mapped.set(key, (mapped.get(key) ?? 0) + portion);
          }
        }
      } else {
        // Single-key actions: fold/check/call or degenerate cases.
        keys.forEach(key => {
          mapped.set(key, (mapped.get(key) ?? 0) + prob / keys.length);
        });
      }
    }

    return this.normalize(mapped);
  }

  private inferActionTypeFromKey(key: string): "fold" | "check" | "call" | "raise" {
    const lower = key.toLowerCase();
    if (lower.includes("raise")) return "raise";
    if (lower.includes("call")) return "call";
    if (lower.includes("check")) return "check";
    return "fold";
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
      if (!Number.isFinite(v) || v <= 0) {
        continue;
      }
      normalized.set(k, v / total);
    }
    return normalized;
  }
}
