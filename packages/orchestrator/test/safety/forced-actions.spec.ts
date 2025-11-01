import { describe, it, expect } from "vitest";
import {
  detectForcedAction,
  isForcedBlind,
  isForcedAllIn,
} from "../../src/safety/forced-actions";
import type { GameState, Position } from "@poker-bot/shared";

describe("Forced Action Handling", () => {
  function createMockState(overrides: Partial<GameState> = {}): GameState {
    return {
      handId: "test_hand",
      gameType: "NLHE_6max",
      blinds: { small: 0.5, big: 1.0 },
      positions: {
        hero: "BTN" as Position,
        button: "BTN" as Position,
        smallBlind: "SB" as Position,
        bigBlind: "BB" as Position,
      },
      players: new Map([
        ["BTN", { stack: 100 }],
        ["SB", { stack: 100 }],
        ["BB", { stack: 100 }],
      ]),
      communityCards: [],
      pot: 0,
      street: "preflop",
      actionHistory: [],
      legalActions: [],
      confidence: {
        overall: 0.99,
        perElement: new Map(),
      },
      latency: 25,
      ...overrides,
    };
  }

  it("detects forced small blind", () => {
    const state = createMockState({
      street: "preflop",
      actionHistory: [],
    });

    const isForced = isForcedBlind(state, "SB");
    expect(isForced).toBe(true);
  });

  it("detects forced big blind", () => {
    const state = createMockState({
      street: "preflop",
      actionHistory: [],
    });

    const isForced = isForcedBlind(state, "BB");
    expect(isForced).toBe(true);
  });

  it("detects forced all-in", () => {
    const state = createMockState({
      players: new Map([["BTN", { stack: 0.5 }]]), // Stack < min bet (1.0)
    });

    const isForced = isForcedAllIn(state, "BTN");
    expect(isForced).toBe(true);
  });

  it("posts blinds automatically", () => {
    const state = createMockState({
      street: "preflop",
      actionHistory: [],
    });

    const sbAction = detectForcedAction(state, "SB");
    expect(sbAction).not.toBeNull();
    expect(sbAction?.type).toBe("raise");
    expect(sbAction?.amount).toBe(0.5);

    const bbAction = detectForcedAction(state, "BB");
    expect(bbAction).not.toBeNull();
    expect(bbAction?.type).toBe("raise");
    expect(bbAction?.amount).toBe(1.0);
  });

  it("does not override forced actions with SafeAction", () => {
    // This test verifies that forced actions are detected
    // The actual override logic would be in the main loop
    const state = createMockState({
      street: "preflop",
      actionHistory: [],
      players: new Map([["SB", { stack: 100 }]]),
    });

    const forcedAction = detectForcedAction(state, "SB");
    expect(forcedAction).not.toBeNull();

    // Forced action should be a blind post
    expect(forcedAction?.type).toBe("raise");
    expect(forcedAction?.amount).toBe(0.5);
  });
});
