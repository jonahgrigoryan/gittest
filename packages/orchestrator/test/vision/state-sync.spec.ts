import { describe, it, expect, beforeEach } from "vitest";
import { StateSyncTracker } from "../../src/vision/state-sync";
import type { ParsedGameState } from "@poker-bot/shared/vision";
import type { Position, Card } from "@poker-bot/shared";

describe("State Sync Tests", () => {
  let tracker: StateSyncTracker;

  beforeEach(() => {
    tracker = new StateSyncTracker(10);
  });

  function createMockState(overrides: Partial<ParsedGameState> = {}): ParsedGameState {
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
      players: new Map([["BTN", { stack: 100 }]]),
      communityCards: [],
      pot: 1.5,
      street: "preflop",
      actionHistory: [],
      legalActions: [],
      confidence: {
        overall: 0.99,
        perElement: new Map(),
      },
      latency: 25,
      parseErrors: [],
      missingElements: [],
      inferredValues: {},
      ...overrides,
    };
  }

  it("detects impossible pot decrease", () => {
    const state1 = createMockState({ pot: 10 });
    const state2 = createMockState({ pot: 5 }); // Pot decreased

    tracker.addFrame(state1);
    const errors = tracker.detectInconsistencies(state2);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("Pot decreased"))).toBe(true);
  });

  it("detects impossible stack increase mid-hand", () => {
    const state1 = createMockState({
      players: new Map([["BTN", { stack: 100 }]]),
    });
    const state2 = createMockState({
      players: new Map([["BTN", { stack: 150 }]]), // Stack increased
    });

    tracker.addFrame(state1);
    const errors = tracker.detectInconsistencies(state2);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("Stack") && e.includes("increased"))).toBe(
      true
    );
  });

  it("allows valid state transitions", () => {
    const state1 = createMockState({
      pot: 10,
      players: new Map([["BTN", { stack: 100 }]]),
      street: "preflop",
    });
    const state2 = createMockState({
      pot: 15, // Pot increased (valid)
      players: new Map([["BTN", { stack: 95 }]]), // Stack decreased (valid)
      street: "flop", // Street advanced (valid)
    });

    tracker.addFrame(state1);
    const errors = tracker.detectInconsistencies(state2);

    expect(errors).toHaveLength(0);
  });

  it("tracks consecutive error count", () => {
    const goodState = createMockState({ parseErrors: [] });
    const badState = createMockState({ parseErrors: ["test error"] });

    tracker.addFrame(goodState);
    tracker.addFrame(badState);
    tracker.addFrame(badState);
    tracker.addFrame(badState);

    expect(tracker.getConsecutiveErrorCount()).toBe(3);
  });
});
