import type { Action, GameState } from "@poker-bot/shared";

export interface RiskLimits {
  bankrollLimit: number;
  sessionLimit: number;
  currentBankroll: number;
  currentSessionHands: number;
}

export interface RiskViolation {
  type: "bankroll" | "session";
  threshold: number;
  observed: number;
  handId?: string;
  pendingExposure?: number;
}

export interface RiskSnapshot {
  netProfit: number;
  drawdown: number;
  handsPlayed: number;
  remainingHands: number;
  remainingBankroll: number;
  liveExposure: number;
  panicStop: boolean;
  panicReason?: RiskViolation;
  updatedAt: number;
}

export interface RiskCheckOptions {
  handId?: string;
  commit?: boolean;
  dryRun?: boolean;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: RiskViolation;
  snapshot: RiskSnapshot;
}

export interface PanicStopEvent {
  triggeredAt: number;
  handId?: string;
  reason: RiskViolation;
  snapshot: RiskSnapshot;
}

export interface RiskGuardOptions {
  logger?: Pick<Console, "info" | "warn" | "error">;
  now?: () => number;
  onPanicStop?: (event: PanicStopEvent) => void;
}

export interface RiskGuardStatePersistence {
  currentBankroll: number;
  currentSessionHands: number;
}

export interface RiskOutcomeUpdate {
  net: number;
  hands?: number;
}

export interface StartHandOptions {
  carryExposure?: number;
}

export interface RiskGuardAPI {
  startHand(handId: string, options?: StartHandOptions): void;
  incrementHandCount(): number;
  recordOutcome(update: RiskOutcomeUpdate): RiskSnapshot;
  updateLimits(limits: Partial<RiskLimits>): RiskSnapshot;
  checkLimits(action: Action, state: GameState, options?: RiskCheckOptions): RiskCheckResult;
  getSnapshot(): RiskSnapshot;
  resetSession(): void;
}
