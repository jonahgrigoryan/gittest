import { describe, expect, it, vi } from "vitest";
import type { Action, GameState, Position } from "@poker-bot/shared";
import { RiskGuard } from "../../src/safety/riskGuard";
import type { RiskLimits } from "../../src/safety/types";

function createGameState(overrides: Partial<GameState> = {}): GameState {
  const positions: Position[] = ["BTN", "SB", "BB", "UTG", "MP", "CO"];
  const players = new Map<Position, { stack: number }>();
  positions.forEach(position => {
    players.set(position, { stack: 1000 });
  });

  const base: GameState = {
    handId: "hand-1",
    gameType: "NLHE_6max",
    blinds: { small: 1, big: 2 },
    positions: {
      hero: "SB",
      button: "BTN",
      smallBlind: "SB",
      bigBlind: "BB",
    },
    players,
    communityCards: [],
    pot: 0,
    street: "preflop",
    actionHistory: [],
    legalActions: [],
    confidence: {
      overall: 1,
      perElement: new Map(),
    },
    latency: 0,
  };

  return {
    ...base,
    ...overrides,
    players: overrides.players ?? players,
    actionHistory: overrides.actionHistory ?? base.actionHistory,
    legalActions: overrides.legalActions ?? base.legalActions,
    confidence: overrides.confidence ?? base.confidence,
  };
}

function createGuard(limits: Partial<RiskLimits> = {}) {
  const guard = new RiskGuard({
    bankrollLimit: limits.bankrollLimit ?? 0,
    sessionLimit: limits.sessionLimit ?? 0,
    currentBankroll: limits.currentBankroll ?? 0,
    currentSessionHands: limits.currentSessionHands ?? 0,
  });
  return guard;
}

describe("RiskGuard", () => {
  it("allows actions when limits are disabled", () => {
    const guard = createGuard();
    const state = createGameState();
    const action: Action = { type: "call", position: "SB", street: "preflop", amount: 50 };
    const result = guard.checkLimits(action, state);
    expect(result.allowed).toBe(true);
    expect(result.snapshot.panicStop).toBe(false);
  });

  it("blocks bankroll breach and triggers panic stop", () => {
    const guard = createGuard({ bankrollLimit: 1000 });
    guard.recordOutcome({ net: -950 });
    const state = createGameState();
    const action: Action = { type: "call", position: "SB", street: "preflop", amount: 100 };
    const result = guard.checkLimits(action, state, { handId: "hand-risk" });
    expect(result.allowed).toBe(false);
    expect(result.reason?.type).toBe("bankroll");
    expect(result.snapshot.panicStop).toBe(true);
    expect(result.snapshot.panicReason?.handId).toBe("hand-risk");
  });

  it("tracks live exposure and rejects when projected loss exceeds limit", () => {
    const guard = createGuard({ bankrollLimit: 1000 });
    const state = createGameState();
    const raise400: Action = { type: "raise", position: "SB", street: "preflop", amount: 400 };
    const first = guard.checkLimits(raise400, state);
    expect(first.allowed).toBe(true);
    const raise700: Action = { type: "raise", position: "SB", street: "preflop", amount: 700 };
    const second = guard.checkLimits(raise700, state, { handId: "hand-7" });
    expect(second.allowed).toBe(false);
    expect(second.reason?.type).toBe("bankroll");
    expect(second.reason?.pendingExposure).toBeGreaterThan(0);
  });

  it("enforces session limit by hand count", () => {
    const guard = createGuard({ sessionLimit: 3 });
    guard.incrementHandCount();
    guard.incrementHandCount();
    guard.incrementHandCount();
    const state = createGameState();
    const action: Action = { type: "check", position: "SB", street: "preflop" };
    const result = guard.checkLimits(action, state);
    expect(result.allowed).toBe(false);
    expect(result.reason?.type).toBe("session");
  });

  it("can reset session and accept new actions", () => {
    const guard = createGuard({ bankrollLimit: 100 });
    guard.recordOutcome({ net: -150 });
    const blocked = guard.checkLimits({ type: "call", position: "SB", street: "preflop", amount: 10 }, createGameState());
    expect(blocked.allowed).toBe(false);
    guard.resetSession();
    const allowed = guard.checkLimits({ type: "call", position: "SB", street: "preflop", amount: 10 }, createGameState());
    expect(allowed.allowed).toBe(true);
  });

  it("subtracts prior contribution for raises", () => {
    const guard = createGuard({ bankrollLimit: 1000 });
    const state = createGameState({
      actionHistory: [
        { type: "raise", position: "SB", street: "preflop", amount: 200 },
      ],
    });
    const action: Action = { type: "raise", position: "SB", street: "preflop", amount: 400 };
    const result = guard.checkLimits(action, state);
    expect(result.allowed).toBe(true);
    // Should only commit the additional 200 chips
    expect(result.snapshot.liveExposure).toBe(200);
  });

  it("fires panic stop callback exactly once per violation", () => {
    const panicSpy = vi.fn();
    const guard = new RiskGuard(
      {
        bankrollLimit: 100,
        sessionLimit: 0,
        currentBankroll: 0,
        currentSessionHands: 0,
      },
      { onPanicStop: panicSpy }
    );
    const state = createGameState();
    guard.recordOutcome({ net: -90 });
    const action: Action = { type: "call", position: "SB", street: "preflop", amount: 20 };
    const result = guard.checkLimits(action, state, { handId: "panic" });
    expect(result.allowed).toBe(false);
    expect(panicSpy).toHaveBeenCalledTimes(1);
    expect(panicSpy.mock.calls[0][0].reason.handId).toBe("panic");
  });
});
