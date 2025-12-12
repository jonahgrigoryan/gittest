import type { Action, ActionKey, GameState, GTOSolution } from "@poker-bot/shared/src/types";
import type { AggregatedAgentOutput } from "@poker-bot/agents";
import { ActionSelector, SeededRNG } from "./selection";
import { BetSizer } from "./sizing";
import type {
  StrategyConfig,
  StrategyDecision,
  StrategyMetadata,
  StrategyReasoningTrace,
  StrategyTimingBreakdown
} from "@poker-bot/shared/src/strategy";

/**
 * Centralized fallback and decision helpers.
 *
 * Responsibilities:
 * - Decide when to run in GTO-only mode.
 * - Build GTO-only StrategyDecision.
 * - Provide SafeAction-based fallbacks when blending/selection fails.
 * - Provide helpers to interpret distribution/selection errors without duplicating logic.
 */
export class FallbackHandler {
  private readonly config: StrategyConfig;
  private readonly logger?: Pick<Console, "debug" | "info" | "warn" | "error">;

  constructor(config: StrategyConfig, logger?: Pick<Console, "debug" | "info" | "warn" | "error">) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Determine whether to bypass agents and use pure GTO.
   * Triggers:
   * - No agent outputs.
   * - Circuit breaker tripped.
   * - All agents failed (droppedAgents present and outputs empty).
   */
  shouldUseGTOOnly(agentOutput: AggregatedAgentOutput | null | undefined): boolean {
    if (!agentOutput) {
      return true;
    }
    if (agentOutput.circuitBreakerTripped) {
      return true;
    }
    if (agentOutput.outputs.length === 0) {
      return true;
    }
    return false;
  }

  /**
   * Build a pure GTO-only decision:
   * - alpha = 1.0 (engine will treat as pure GTO).
   * - Samples from GTOSolution distribution only.
   * - Applies BetSizer.
   * - Does NOT perform risk checks; caller must apply StrategyRiskIntegration after.
   */
  createGTOOnlyDecision(params: {
    state: GameState;
    gto: GTOSolution;
    selector: ActionSelector;
    betSizer: BetSizer;
    rngSeed: number;
    timing?: Partial<StrategyTimingBreakdown>;
    metadataBase?: Partial<StrategyMetadata>;
  }): StrategyDecision {
    const { state, gto, selector, betSizer, rngSeed, timing = {}, metadataBase = {} } = params;

    const dist = this.extractGtoDistribution(gto);
    if (dist.size === 0) {
      const safe = this.buildLocalSafeAction(state);
      this.logger?.warn?.("FallbackHandler: empty GTO distribution, using SafeAction", {
        handId: state.handId
      });
      // GTO-only path -> mark as GTO-only fallback
      return this.buildTrivialDecision(
        state,
        safe,
        "gto_empty",
        timing,
        { ...metadataBase, usedGtoOnlyFallback: true, rngSeed: rngSeed ?? metadataBase.rngSeed }
      );
    }

    const rng = new SeededRNG(rngSeed);
    const selected = selector.selectActionForState(dist, state, rng);
    if (!selected.ok) {
      const safe = this.buildLocalSafeAction(state);
      this.logger?.warn?.("FallbackHandler: invalid GTO selection, using SafeAction", {
        handId: state.handId,
        reason: selected.reason
      });
      // GTO-only selection failure -> mark as GTO-only fallback
      return this.buildTrivialDecision(
        state,
        safe,
        `gto_invalid_selection:${selected.reason}`,
        timing,
        { ...metadataBase, usedGtoOnlyFallback: true, rngSeed: rngSeed ?? metadataBase.rngSeed }
      );
    }

    const sizedResult = betSizer.quantizeBetSize(selected.action, state);

    if (!sizedResult.ok) {
      const safe = this.buildLocalSafeAction(state);
      this.logger?.warn?.("FallbackHandler: BetSizer failed in GTO-only path, using SafeAction", {
        handId: state.handId,
        reason: sizedResult.reason
      });
      // Explicit GTO-only sizing failure path with correct reason + flag
      return this.buildTrivialDecision(
        state,
        safe,
        `gto_only_sizing_failed:${sizedResult.reason}`,
        timing,
        { ...metadataBase, usedGtoOnlyFallback: true, rngSeed: rngSeed ?? metadataBase.rngSeed }
      );
    }

    const sized = sizedResult.action;

    const reasoning: StrategyReasoningTrace = {
      gtoRecommendation: dist,
      agentRecommendation: new Map<ActionKey, number>(),
      blendedDistribution: dist,
      alpha: 1.0,
      divergence: 0,
      riskCheckPassed: false,
      sizingQuantized: sized.amount !== selected.action.amount,
      fallbackReason: "gto_only"
    };

    const finalTiming: StrategyTimingBreakdown = {
      gtoTime: timing.gtoTime ?? 0,
      agentTime: timing.agentTime ?? 0,
      synthesisTime: timing.synthesisTime ?? 0,
      totalTime: timing.totalTime ?? 0
    };

    const metadata: StrategyMetadata = {
      rngSeed: rngSeed ?? (metadataBase.rngSeed ?? 0),
      configSnapshot: this.config,
      riskSnapshot: metadataBase.riskSnapshot,
      modelHashes: metadataBase.modelHashes,
      preempted: metadataBase.preempted ?? false,
      // GTO-only constructor always represents a GTO-only fallback decision
      usedGtoOnlyFallback: true,
      panicStop: metadataBase.panicStop ?? false
    };

    return {
      action: sized,
      reasoning,
      timing: finalTiming,
      metadata
    };
  }

  /**
   * Use when blended distribution or selection fails:
   * - Prefer SafeAction based on GameState.
   * - Encode fallbackReason for the engine.
   */
  createSafeActionDecision(params: {
    state: GameState;
    reason: string;
    timing?: Partial<StrategyTimingBreakdown>;
    metadataBase?: Partial<StrategyMetadata>;
  }): StrategyDecision {
    const { state, reason, timing = {}, metadataBase = {} } = params;
    const safe = this.buildLocalSafeAction(state);

    const reasoning: StrategyReasoningTrace = {
      gtoRecommendation: new Map<ActionKey, number>(),
      agentRecommendation: new Map<ActionKey, number>(),
      blendedDistribution: new Map<ActionKey, number>(),
      alpha: this.config.alphaGTO,
      divergence: 0,
      riskCheckPassed: false,
      sizingQuantized: false,
      fallbackReason: reason
    };

    const finalTiming: StrategyTimingBreakdown = {
      gtoTime: timing.gtoTime ?? 0,
      agentTime: timing.agentTime ?? 0,
      synthesisTime: timing.synthesisTime ?? 0,
      totalTime: timing.totalTime ?? 0
    };

    const metadata: StrategyMetadata = {
      rngSeed: metadataBase.rngSeed ?? 0,
      configSnapshot: this.config,
      riskSnapshot: metadataBase.riskSnapshot,
      modelHashes: metadataBase.modelHashes,
      preempted: metadataBase.preempted ?? false,
      usedGtoOnlyFallback: metadataBase.usedGtoOnlyFallback ?? false,
      panicStop: metadataBase.panicStop ?? false
    };

    this.logger?.warn?.("FallbackHandler: using SafeAction fallback", {
      handId: state.handId,
      reason
    });

    return {
      action: safe,
      reasoning,
      timing: finalTiming,
      metadata
    };
  }

  /**
   * Extract plain GTO distribution from GTOSolution for fallback paths.
   */
  private extractGtoDistribution(gto: GTOSolution): Map<ActionKey, number> {
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

  /**
   * Very conservative SafeAction: hero check > hero fold > first hero action > synthetic fold.
   * StrategyRiskIntegration exposes a similar helper; this one is local for pure fallback usage.
   */
  private buildLocalSafeAction(state: GameState): Action {
    const hero = state.positions.hero;
    const legal = state.legalActions ?? [];

    const check = legal.find(a => a.position === hero && a.type === "check");
    if (check) return check;

    const fold = legal.find(a => a.position === hero && a.type === "fold");
    if (fold) return fold;

    const heroAction = legal.find(a => a.position === hero);
    if (heroAction) return heroAction;

    return {
      type: "fold",
      position: hero,
      street: state.street
    };
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

  private buildTrivialDecision(
    state: GameState,
    action: Action,
    reason: string,
    timing: Partial<StrategyTimingBreakdown>,
    metadataBase: Partial<StrategyMetadata>
  ): StrategyDecision {
    const reasoning: StrategyReasoningTrace = {
      gtoRecommendation: new Map<ActionKey, number>(),
      agentRecommendation: new Map<ActionKey, number>(),
      blendedDistribution: new Map<ActionKey, number>(),
      alpha: this.config.alphaGTO,
      divergence: 0,
      riskCheckPassed: false,
      sizingQuantized: false,
      fallbackReason: reason
    };

    const finalTiming: StrategyTimingBreakdown = {
      gtoTime: timing.gtoTime ?? 0,
      agentTime: timing.agentTime ?? 0,
      synthesisTime: timing.synthesisTime ?? 0,
      totalTime: timing.totalTime ?? 0
    };

    const metadata: StrategyMetadata = {
      rngSeed: metadataBase.rngSeed ?? 0,
      configSnapshot: this.config,
      riskSnapshot: metadataBase.riskSnapshot,
      modelHashes: metadataBase.modelHashes,
      preempted: metadataBase.preempted ?? false,
      usedGtoOnlyFallback: metadataBase.usedGtoOnlyFallback ?? false,
      panicStop: metadataBase.panicStop ?? false
    };

    return {
      action,
      reasoning,
      timing: finalTiming,
      metadata
    };
  }
}
