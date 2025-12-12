import type { Action, GameState, Position } from "@poker-bot/shared/src/types";
import type {
  PanicStopEvent,
  RiskCheckOptions,
  RiskCheckResult,
  RiskGuardOptions,
  RiskLimits,
  RiskOutcomeUpdate,
  RiskSnapshot,
  RiskViolation,
  StartHandOptions,
} from "./types";
import { getCallAmount } from "../vision/legal-actions";

const EPSILON = 1e-6;

export class RiskGuard {
  private limits: RiskLimits;
  private readonly logger?: Pick<Console, "info" | "warn" | "error">;
  private readonly now: () => number;
  private readonly onPanicStop?: (event: PanicStopEvent) => void;

  private handsPlayed: number;
  private netProfit: number;
  private liveExposure = 0;
  private panicStop = false;
  private panicReason?: RiskViolation;
  private currentHandId?: string;

  constructor(limits: RiskLimits, options: RiskGuardOptions = {}) {
    this.limits = { ...limits };
    this.logger = options.logger;
    this.now = options.now ?? (() => Date.now());
    this.onPanicStop = options.onPanicStop;
    this.handsPlayed = this.normalizeNumber(limits.currentSessionHands);
    this.netProfit = this.normalizeNumber(limits.currentBankroll);
  }

  startHand(handId: string, options: StartHandOptions = {}): void {
    this.currentHandId = handId;
    this.liveExposure = Math.max(0, options.carryExposure ?? 0);
    if (this.panicStop && !this.isCurrentlyViolating()) {
      this.panicStop = false;
      this.panicReason = undefined;
    }
  }

  incrementHandCount(): number {
    this.handsPlayed += 1;
    return this.getRemainingHands();
  }

  recordOutcome(update: RiskOutcomeUpdate): RiskSnapshot {
    const delta = this.normalizeNumber(update.net);
    this.netProfit += delta;
    if (update.hands && update.hands > 0) {
      this.handsPlayed += update.hands;
    }
    this.liveExposure = 0;
    return this.buildSnapshot();
  }

  updateLimits(limits: Partial<RiskLimits>): RiskSnapshot {
    this.limits = {
      bankrollLimit: limits.bankrollLimit ?? this.limits.bankrollLimit,
      sessionLimit: limits.sessionLimit ?? this.limits.sessionLimit,
      currentBankroll: this.netProfit,
      currentSessionHands: this.handsPlayed,
    };
    if (this.isCurrentlyViolating()) {
      this.triggerPanic(
        this.panicReason ?? {
          type: "bankroll",
          threshold: this.limits.bankrollLimit,
          observed: this.getProjectedDrawdown(this.liveExposure),
          handId: this.currentHandId,
          pendingExposure: this.liveExposure,
        },
      );
    } else if (this.panicStop) {
      this.panicStop = false;
      this.panicReason = undefined;
    }
    return this.buildSnapshot();
  }

  resetSession(): void {
    this.handsPlayed = 0;
    this.netProfit = 0;
    this.liveExposure = 0;
    this.panicStop = false;
    this.panicReason = undefined;
    this.limits.currentBankroll = 0;
    this.limits.currentSessionHands = 0;
  }

  getSnapshot(): RiskSnapshot {
    return this.buildSnapshot();
  }

  checkLimits(action: Action, state: GameState, options: RiskCheckOptions = {}): RiskCheckResult {
    const handId = options.handId ?? this.currentHandId ?? state.handId;
    const snapshot = this.buildSnapshot();

    if (this.panicStop) {
      return {
        allowed: false,
        reason: this.panicReason,
        snapshot,
      };
    }

    const incremental = this.calculateIncrementalCommitment(action, state);
    const projectedExposure = this.liveExposure + incremental;
    const violation = this.evaluateViolation(projectedExposure, handId);
    if (violation) {
      const panicSnapshot = this.triggerPanic(violation);
      return {
        allowed: false,
        reason: violation,
        snapshot: panicSnapshot,
      };
    }

    const shouldCommit = options.dryRun ? false : options.commit ?? true;
    if (shouldCommit) {
      this.liveExposure = projectedExposure;
    }

    return {
      allowed: true,
      snapshot: this.buildSnapshot(),
    };
  }

  private evaluateViolation(projectedExposure: number, handId?: string): RiskViolation | undefined {
    if (this.shouldEnforce(this.limits.bankrollLimit)) {
      const projectedDrawdown = this.getProjectedDrawdown(projectedExposure);
      if (projectedDrawdown - this.limits.bankrollLimit > EPSILON) {
        return {
          type: "bankroll",
          threshold: this.limits.bankrollLimit,
          observed: projectedDrawdown,
          handId,
          pendingExposure: projectedExposure,
        };
      }
    }

    if (this.shouldEnforce(this.limits.sessionLimit) && this.handsPlayed >= this.limits.sessionLimit) {
      return {
        type: "session",
        threshold: this.limits.sessionLimit,
        observed: this.handsPlayed,
        handId,
      };
    }

    return undefined;
  }

  private getProjectedDrawdown(projectedExposure: number): number {
    const drawdown = Math.max(0, -this.netProfit);
    return drawdown + projectedExposure;
  }

  private triggerPanic(reason: RiskViolation): RiskSnapshot {
    this.panicStop = true;
    this.panicReason = reason;
    const snapshot = this.buildSnapshot();
    this.logger?.warn?.("RiskGuard: panic stop triggered", {
      reason: reason.type,
      observed: reason.observed,
      threshold: reason.threshold,
      handId: reason.handId,
      pendingExposure: reason.pendingExposure,
    });
    this.onPanicStop?.({
      triggeredAt: this.now(),
      handId: reason.handId,
      reason,
      snapshot,
    });
    return snapshot;
  }

  private isCurrentlyViolating(): boolean {
    if (this.shouldEnforce(this.limits.bankrollLimit)) {
      const drawdown = this.getProjectedDrawdown(this.liveExposure);
      if (drawdown - this.limits.bankrollLimit > EPSILON) {
        return true;
      }
    }
    if (this.shouldEnforce(this.limits.sessionLimit) && this.handsPlayed >= this.limits.sessionLimit) {
      return true;
    }
    return false;
  }

  private calculateIncrementalCommitment(action: Action, state: GameState): number {
    const heroPosition = state.positions.hero;
    const heroInfo = state.players.get(heroPosition);
    if (!heroInfo) {
      return 0;
    }

    switch (action.type) {
      case "call": {
        const amountToCall = this.normalizeNumber(action.amount ?? getCallAmount(state));
        return Math.min(amountToCall, heroInfo.stack);
      }
      case "raise": {
        const targetAmount = this.normalizeNumber(action.amount ?? 0);
        const heroContribution = this.getHeroContribution(state, heroPosition);
        const incremental = Math.max(0, targetAmount - heroContribution);
        return Math.min(incremental, heroInfo.stack);
      }
      default:
        return 0;
    }
  }

  private getHeroContribution(state: GameState, position: Position): number {
    let contribution = 0;
    for (const action of state.actionHistory) {
      if (action.position !== position) {
        continue;
      }
      if (action.type === "call" || action.type === "raise") {
        contribution = this.normalizeNumber(action.amount ?? contribution);
      }
    }
    return contribution;
  }

  private getRemainingHands(): number {
    if (!this.shouldEnforce(this.limits.sessionLimit)) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.max(0, this.limits.sessionLimit - this.handsPlayed);
  }

  private getRemainingBankroll(): number {
    if (!this.shouldEnforce(this.limits.bankrollLimit)) {
      return Number.POSITIVE_INFINITY;
    }
    const projected = this.getProjectedDrawdown(this.liveExposure);
    return Math.max(0, this.limits.bankrollLimit - projected);
  }

  private buildSnapshot(): RiskSnapshot {
    return {
      netProfit: this.netProfit,
      drawdown: Math.max(0, -this.netProfit),
      handsPlayed: this.handsPlayed,
      remainingHands: this.getRemainingHands(),
      remainingBankroll: this.getRemainingBankroll(),
      liveExposure: this.liveExposure,
      panicStop: this.panicStop,
      panicReason: this.panicReason,
      updatedAt: this.now(),
    };
  }

  private shouldEnforce(limit: number): boolean {
    return Number.isFinite(limit) && limit > 0;
  }

  private normalizeNumber(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return 0;
    }
    return value;
  }
}
