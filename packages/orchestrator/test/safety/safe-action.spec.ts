import { describe, it, expect } from "vitest";
import { selectSafeAction } from "../../src/safety/safe-action";
import type { ParsedGameState } from "@poker-bot/shared/vision";
import type { Position } from "@poker-bot/shared";

describe("SafeAction Selection", () => {
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

  it("selects check preflop when legal", () => {
    const state = createMockState({
      street: "preflop",
      actionHistory: [], // No one has bet, check is legal
    });

    const action = selectSafeAction(state);

    expect(action.type).toBe("check");
  });

  it("selects fold preflop when check not legal", () => {
    const state = createMockState({
      street: "preflop",
      actionHistory: [
        {
          type: "raise",
          amount: 3,
          position: "BB" as Position,
          street: "preflop",
        },
      ],
    });

    const action = selectSafeAction(state);

    expect(action.type).toBe("fold");
  });

  it("selects check postflop when legal", () => {
    const state = createMockState({
      street: "flop",
      actionHistory: [],
    });

    const action = selectSafeAction(state);

    expect(action.type).toBe("check");
  });

  it("selects fold postflop when check not legal", () => {
    const state = createMockState({
      street: "flop",
      actionHistory: [
        {
          type: "raise",
          amount: 10,
          position: "BB" as Position,
          street: "flop",
        },
      ],
    });

    const action = selectSafeAction(state);

    expect(action.type).toBe("fold");
  });

  it("never selects raise in safe mode", () => {
    // Test multiple scenarios
    const scenarios = [
      createMockState({ street: "preflop" }),
      createMockState({ street: "flop" }),
      createMockState({ street: "turn" }),
      createMockState({ street: "river" }),
    ];

    for (const state of scenarios) {
      const action = selectSafeAction(state);
      expect(action.type).not.toBe("raise");
    }
  });
});
