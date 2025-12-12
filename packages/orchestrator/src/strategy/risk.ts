import type { Action, GameState, Position } from "@poker-bot/shared/src/types";
import type {
  RiskCheckOptions,
  RiskCheckResult,
  RiskSnapshot,
  RiskGuardAPI as RiskController
} from "../safety/types";

/**
 * Thin integration wrapper over orchestrator RiskGuard (Task 7).
 * Does not own lifecycle or persistence; that is handled in main.ts.
 */
export class StrategyRiskIntegration {
  private readonly risk: RiskController;
  private readonly logger?: Pick<Console, "debug" | "info" | "warn" | "error">;

  constructor(riskController: RiskController, logger?: Pick<Console, "debug" | "info" | "warn" | "error">) {
    this.risk = riskController;
    this.logger = logger;
  }

  /**
   * Enforce risk limits for a candidate action. If rejected, fallbackActionFactory
   * is used to compute a SafeAction (or GTO-only) alternative.
   *
   * Returns both the chosen action and the underlying RiskCheckResult.
   */
  enforceWithFallback(
    action: Action,
    state: GameState,
    fallbackActionFactory: () => Action,
    options?: RiskCheckOptions
  ): { action: Action; result: RiskCheckResult } {
    const result = this.risk.checkLimits(action, state, options);
    if (result.allowed) {
      return { action, result };
    }

    const fallback = fallbackActionFactory();
    this.logViolation(result, action, fallback, state);
    return { action: fallback, result };
  }

  /**
   * Convenience helper to produce a conservative SafeAction based purely on GameState:
   * - Prefer hero "check" if legal.
   * - Otherwise hero "fold" if legal.
   * - Otherwise first legal hero action (as a last resort).
   *
   * This avoids relying on ParsedGameState/vision types inside the strategy layer.
   */
  getSafeAction(state: GameState): Action {
    const hero: Position = state.positions.hero;
    const legal = state.legalActions ?? [];

    const preferredCheck = legal.find(a => a.position === hero && a.type === "check");
    if (preferredCheck) {
      return preferredCheck;
    }

    const preferredFold = legal.find(a => a.position === hero && a.type === "fold");
    if (preferredFold) {
      return preferredFold;
    }

    const heroAction = legal.find(a => a.position === hero);
    if (heroAction) {
      return heroAction;
    }

    // Absolute fallback: synthetic fold for hero on current street.
    return {
      type: "fold",
      position: hero,
      street: state.street
    };
  }

  /**
   * Expose current risk snapshot for StrategyDecision.metadata.
   */
  getSnapshot(): RiskSnapshot {
    return this.risk.getSnapshot();
  }

  private logViolation(
    result: RiskCheckResult,
    attempted: Action,
    fallback: Action,
    state: GameState
  ): void {
    const snap = result.snapshot;
    const reason = result.reason;

    this.logger?.warn?.("StrategyEngine: risk violation, applying fallback", {
      handId: state.handId,
      attempted,
      fallback,
      reason,
      snapshot: snap
    });
  }
}
