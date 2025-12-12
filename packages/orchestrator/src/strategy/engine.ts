import { generateRngSeed } from "@poker-bot/shared/src/rng";
import type { ActionKey, GameState, GTOSolution } from "@poker-bot/shared/src/types";
import type { AggregatedAgentOutput } from "@poker-bot/agents";
import { TimeBudgetTracker } from "../budget/timeBudgetTracker";
import type { RiskGuardAPI as RiskController } from "../safety/types";
import { StrategyBlender } from "./blending";
import { ActionSelector, deriveRngForDecision } from "./selection";
import { BetSizer } from "./sizing";
import { DivergenceDetector } from "./divergence";
import { StrategyRiskIntegration } from "./risk";
import { FallbackHandler } from "./fallbacks";
import { OpponentModeler } from "./modeling";
import type {
  BlendedDistribution,
  StrategyConfig,
  StrategyDecision,
  StrategyEngineDeps,
  StrategyMetadata,
  StrategyReasoningTrace,
  StrategyTimingBreakdown
} from "./types";

/**
 * StrategyEngine
 *
 * Orchestrates:
 * - GTO / agent blending
 * - Action selection via seeded RNG
 * - Bet sizing quantization
 * - Divergence detection & logging
 * - Risk enforcement with SafeAction fallback
 * - Centralized GTO-only and SafeAction fallbacks
 * - 2-second deadline compliance via TimeBudgetTracker
 */
export class StrategyEngine {
  private config: StrategyConfig;
  private readonly logger?: Pick<Console, "debug" | "info" | "warn" | "error">;
  private readonly blender: StrategyBlender;
  private readonly selector: ActionSelector;
  private readonly betSizer: BetSizer;
  private readonly divergence: DivergenceDetector;
  private readonly risk: StrategyRiskIntegration;
  private readonly fallback: FallbackHandler;
  private readonly opponentModeler?: OpponentModeler;
  private readonly timeBudgetTracker?: TimeBudgetTracker;

  constructor(config: StrategyConfig, riskController: RiskController, deps?: StrategyEngineDeps) {
    this.config = config;
    this.logger = deps?.logger ?? console;

    this.blender = new StrategyBlender(config, this.logger);
    this.selector = new ActionSelector(config.rngSeed);
    this.betSizer = new BetSizer(config);
    this.divergence = new DivergenceDetector(config, this.logger);
    this.risk = new StrategyRiskIntegration(riskController, this.logger);
    this.fallback = new FallbackHandler(config, this.logger);

    if (config.opponentModeling?.enabled) {
      this.opponentModeler = new OpponentModeler(config);
      this.logger?.info?.("StrategyEngine: OpponentModeler enabled", {
        minHands: config.opponentModeling.minHands
      });
    }

    this.timeBudgetTracker = deps?.timeBudgetTracker;
  }

  /**
   * Main decision entrypoint.
   *
   * Expects:
   * - state: current GameState (already validated/normalized by orchestrator)
   * - gtoSolution: GTOSolution from solver
   * - agentOutput: AggregatedAgentOutput from agents coordinator
   *
   * Returns:
   * - StrategyDecision (final action + full reasoning/timing/metadata)
   */
  decide(
    state: GameState,
    gtoSolution: GTOSolution,
    agentOutput: AggregatedAgentOutput,
    sessionId: string
  ): StrategyDecision {
    const start = performanceNow();
    const timing: Partial<StrategyTimingBreakdown> = {};
    const baseMetadata: Partial<StrategyMetadata> = {};
    const rngSeed = this.resolveRngSeed(state.handId, sessionId);

    // 1. Fast path: determine if we must use pure GTO-only.
    if (this.fallback.shouldUseGTOOnly(agentOutput)) {
      this.logger?.info?.("StrategyEngine: using GTO-only fallback (agent failure/circuit breaker)");
      const decision = this.fallback.createGTOOnlyDecision({
        state,
        gto: gtoSolution,
        selector: this.selector,
        betSizer: this.betSizer,
        rngSeed,
        timing,
        metadataBase: {
          ...baseMetadata,
          usedGtoOnlyFallback: true
        }
      });

      // Enforce risk on the GTO-only decision.
      const enforced = this.applyRisk(decision, state, "gto_only");
      return this.finalizeDecision(enforced, start, timing);
    }

    // 2. Deadline pre-check: if nearly out of time, route through GTO-only.
    const preempted = this.shouldPreempt();
    if (preempted) {
      this.logger?.warn?.("StrategyEngine: preempting to GTO-only due to time budget");
      const decision = this.fallback.createGTOOnlyDecision({
        state,
        gto: gtoSolution,
        selector: this.selector,
        betSizer: this.betSizer,
        rngSeed,
        timing,
        metadataBase: {
          ...baseMetadata,
          preempted: true,
          usedGtoOnlyFallback: true
        }
      });
      const enforced = this.applyRisk(decision, state, "deadline_preempt");
      return this.finalizeDecision(enforced, start, timing);
    }

    // 3. Blend GTO + agent recommendations.
    const blended: BlendedDistribution = this.blender.blend(gtoSolution, agentOutput);
    const gtoDist = this.extractMapFromGTOSolution(gtoSolution);
    const agentDist = agentOutput.normalizedActions instanceof Map
      ? agentOutput.normalizedActions as Map<ActionKey, number>
      : new Map<ActionKey, number>();

    // 4. Divergence detection & logging.
    const divergencePP = this.divergence.logIfNeeded(
      state.handId,
      gtoDist,
      agentDist,
      blended.alpha,
      rngSeed
    );

    // 5. Selection from blended distribution.
    const rng = deriveRngForDecision(this.selector, this.config, {
      state,
      sessionId,
      seedOverride: rngSeed
    });
    const pickResult = this.selector.selectActionForState(blended.actions, state, rng);
    if (!pickResult.ok) {
      this.logger?.warn?.("StrategyEngine: blended selection failed, using SafeAction fallback", {
        handId: state.handId,
        reason: pickResult.reason
      });
      const safeDecision = this.fallback.createSafeActionDecision({
        state,
        reason: `selection_failed:${pickResult.reason}`,
        timing,
        metadataBase: {
          ...baseMetadata,
          rngSeed
        }
      });
      const enforced = this.applyRisk(safeDecision, state, "selection_failed");
      return this.finalizeDecision(enforced, start, timing);
    }

    // 6. Bet sizing quantization.
    const sizedResult = this.betSizer.quantizeBetSize(pickResult.action, state);

    if (!sizedResult.ok) {
      this.logger?.warn?.("StrategyEngine: BetSizer failed, using SafeAction fallback", {
        handId: state.handId,
        reason: sizedResult.reason
      });

      // Treat as a selection failure with explicit sizing context so the reason type is valid.
      const safeDecision = this.fallback.createSafeActionDecision({
        state,
        reason: `selection_failed:sizing_failed:${sizedResult.reason}`,
        timing,
        metadataBase: {
          ...baseMetadata,
          rngSeed,
          preempted: false,
          usedGtoOnlyFallback: true
        }
      });

      const enforcedSafe = this.applyRisk(safeDecision, state, "selection_failed");
      return this.finalizeDecision(enforcedSafe, start, timing);
    }

    const sized = sizedResult.action;

    // 7. Risk enforcement (with SafeAction fallback).
    const reasoning: StrategyReasoningTrace = {
      gtoRecommendation: gtoDist,
      agentRecommendation: agentDist,
      blendedDistribution: blended.actions,
      alpha: blended.alpha,
      divergence: divergencePP,
      riskCheckPassed: false,
      sizingQuantized: sized.amount !== pickResult.action.amount,
      fallbackReason: undefined
    };

    let decision: StrategyDecision = {
      action: sized,
      reasoning,
      timing: this.buildTiming(timing, start),
      metadata: this.buildMetadata(state, rngSeed, {
        preempted: false,
        usedGtoOnlyFallback: false
      })
    };

    decision = this.applyRisk(decision, state, "normal");

    // 8. Record action into opponent modeler (if enabled) for future adjustments.
    if (this.opponentModeler) {
      try {
        // For now, record hero's chosen action as part of behavioral stats.
        // In future, this can be extended with villain actions when available.
        this.opponentModeler.recordAction(
          decision.action.position,
          decision.action,
          state.street
        );
      } catch (error) {
        this.logger?.warn?.("StrategyEngine: OpponentModeler.recordAction failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // 9. Final timing/metadata adjustments.
    return this.finalizeDecision(decision, start, timing);
  }

  /**
   * Apply risk checks to a candidate decision.
   * If blocked, use StrategyRiskIntegration.getSafeAction as fallback.
   */
  private applyRisk(
    decision: StrategyDecision,
    state: GameState,
    context: "gto_only" | "deadline_preempt" | "selection_failed" | "normal"
  ): StrategyDecision {
    const { action } = decision;
    const safeFactory = () => this.risk.getSafeAction(state);
    const { action: enforcedAction, result } = this.risk.enforceWithFallback(
      action,
      state,
      safeFactory,
      { commit: true }
    );

    const updatedReasoning: StrategyReasoningTrace = {
      ...decision.reasoning,
      riskCheckPassed: result.allowed,
      fallbackReason: !result.allowed
        ? (decision.reasoning.fallbackReason
            ? `${decision.reasoning.fallbackReason}|risk_violation`
            : `risk_violation:${result.reason?.type ?? "unknown"}`)
        : decision.reasoning.fallbackReason
    };

    const riskSnapshot = result.snapshot;
    const updatedMetadata: StrategyMetadata = {
      ...decision.metadata,
      riskSnapshot,
      panicStop: riskSnapshot.panicStop || decision.metadata.panicStop === true,
      usedGtoOnlyFallback:
        decision.metadata.usedGtoOnlyFallback ||
        context === "gto_only" ||
        context === "deadline_preempt"
    };

    if (!result.allowed) {
      this.logger?.warn?.("StrategyEngine: risk violation enforced fallback", {
        handId: state.handId,
        context,
        reason: result.reason,
        snapshot: riskSnapshot
      });
    }

    return {
      action: enforcedAction,
      reasoning: updatedReasoning,
      timing: decision.timing,
      metadata: updatedMetadata
    };
  }

  /**
   * Decide whether to preempt full blending + selection due to time budget.
   */
  private shouldPreempt(): boolean {
    if (!this.timeBudgetTracker) {
      return false;
    }
    try {
      const remaining = this.timeBudgetTracker.remaining
        ? this.timeBudgetTracker.remaining()
        : undefined;

      if (remaining !== undefined && remaining < 100) {
        return true;
      }

      if (this.timeBudgetTracker.shouldPreempt) {
        // Use generic preempt check without forcing a specific component name.
        return this.timeBudgetTracker.shouldPreempt("gto") === true;
      }

      return false;
    } catch {
      return false;
    }
  }

  private extractMapFromGTOSolution(gto: GTOSolution): Map<ActionKey, number> {
    const out = new Map<ActionKey, number>();
    if (!gto || !gto.actions) {
      return out;
    }
    for (const [key, entry] of gto.actions.entries()) {
      const freq = entry?.solution?.frequency;
      if (typeof freq === "number" && freq > 0 && Number.isFinite(freq)) {
        out.set(key, freq);
      }
    }
    return this.normalize(out);
  }

  private mapAgentTypesToKeys(
    agentOutput: AggregatedAgentOutput,
    gtoDist: Map<ActionKey, number>
  ): Map<ActionKey, number> {
    const mapped = new Map<ActionKey, number>();
    if (!agentOutput || !(agentOutput.normalizedActions instanceof Map)) {
      return mapped;
    }

    const byType: Record<string, ActionKey[]> = {
      fold: [],
      check: [],
      call: [],
      raise: []
    };

    for (const key of gtoDist.keys()) {
      const lower = key.toLowerCase();
      if (lower.includes("raise")) {
        byType.raise.push(key);
      } else if (lower.includes("call")) {
        byType.call.push(key);
      } else if (lower.includes("check")) {
        byType.check.push(key);
      } else {
        byType.fold.push(key);
      }
    }

    for (const [actionType, prob] of agentOutput.normalizedActions.entries()) {
      if (!Number.isFinite(prob) || prob <= 0) continue;
      const keys = byType[actionType];
      if (!keys || keys.length === 0) continue;

      if (actionType === "raise" && keys.length > 1) {
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
        const portion = prob / keys.length;
        for (const key of keys) {
          mapped.set(key, (mapped.get(key) ?? 0) + portion);
        }
      }
    }

    return this.normalize(mapped);
  }

  private normalize(dist: Map<ActionKey, number>): Map<ActionKey, number> {
    let total = 0;
    for (const v of dist.values()) {
      if (Number.isFinite(v) && v > 0) {
        total += v;
      }
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

  private buildTiming(
    partial: Partial<StrategyTimingBreakdown>,
    start: number
  ): StrategyTimingBreakdown {
    const now = performanceNow();
    const synthesis = now - start - (partial.gtoTime ?? 0) - (partial.agentTime ?? 0);
    const timing: StrategyTimingBreakdown = {
      gtoTime: partial.gtoTime ?? 0,
      agentTime: partial.agentTime ?? 0,
      synthesisTime: synthesis > 0 ? synthesis : 0,
      totalTime: now - start
    };
    return timing;
  }

  private buildMetadata(
    state: GameState,
    rngSeed: number,
    extras?: Partial<StrategyMetadata>
  ): StrategyMetadata {
    return {
      rngSeed,
      configSnapshot: this.config,
      riskSnapshot: extras?.riskSnapshot,
      modelHashes: extras?.modelHashes ?? {},
      preempted: extras?.preempted ?? false,
      usedGtoOnlyFallback: extras?.usedGtoOnlyFallback ?? false,
      panicStop: extras?.panicStop ?? false
    };
  }

  private finalizeDecision(
    decision: StrategyDecision,
    start: number,
    timingPartial: Partial<StrategyTimingBreakdown>
  ): StrategyDecision {
    const timing = this.buildTiming(timingPartial, start);
    return {
      action: decision.action,
      reasoning: decision.reasoning,
      timing,
      metadata: {
        ...decision.metadata,
        configSnapshot: this.config
      }
    };
  }

  private resolveRngSeed(handId: string | undefined, sessionId: string): number {
    if (typeof this.config.rngSeed === "number") {
      return this.config.rngSeed >>> 0;
    }
    const normalizedHandId = handId ?? "unknown-hand";
    const normalizedSession = sessionId ?? "unknown-session";
    return generateRngSeed(normalizedHandId, normalizedSession);
  }
}

/**
 * Small performance.now() helper that works under Node.
 */
function performanceNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  const [sec, nano] = process.hrtime();
  return sec * 1000 + nano / 1e6;
}
