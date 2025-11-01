import { describe, it, expect } from "vitest";
import { shouldTriggerSafeAction } from "../../src/safety/safe-action";
import type { ParsedGameState } from "@poker-bot/shared/vision";
import type { BotConfig, Position } from "@poker-bot/shared";

describe("Confidence Gating", () => {
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
        overall: 0.999,
        perElement: new Map(),
      },
      latency: 25,
      parseErrors: [],
      missingElements: [],
      inferredValues: {},
      ...overrides,
    };
  }

  const defaultBotConfig: BotConfig = {
    vision: {
      confidenceThreshold: 0.995,
      occlusionThreshold: 0.05,
    },
  } as BotConfig;

  it("triggers SafeAction when overall confidence < 0.995", () => {
    const state = createMockState({
      confidence: {
        overall: 0.99, // Below threshold
        perElement: new Map(),
      },
    });

    const shouldTrigger = shouldTriggerSafeAction(state, defaultBotConfig);
    expect(shouldTrigger).toBe(true);
  });

  it("triggers SafeAction when any element occluded > 5%", () => {
    const state = createMockState({
      confidence: {
        overall: 0.999,
        perElement: new Map([["occlusion_cards", 0.06]]), // 6% > 5%
      },
    });

    const shouldTrigger = shouldTriggerSafeAction(state, defaultBotConfig);
    expect(shouldTrigger).toBe(true);
  });

  it("does not trigger when confidence = 0.995", () => {
    const state = createMockState({
      confidence: {
        overall: 0.995, // Exact threshold
        perElement: new Map(),
      },
    });

    const shouldTrigger = shouldTriggerSafeAction(state, defaultBotConfig);
    expect(shouldTrigger).toBe(false);
  });

  it("does not trigger when occlusion = 5%", () => {
    const state = createMockState({
      confidence: {
        overall: 0.999,
        perElement: new Map([["occlusion_cards", 0.05]]), // Exact threshold
      },
    });

    const shouldTrigger = shouldTriggerSafeAction(state, defaultBotConfig);
    expect(shouldTrigger).toBe(false);
  });

  it("uses config thresholds correctly", () => {
    const customConfig: BotConfig = {
      vision: {
        confidenceThreshold: 0.99, // Lower threshold
        occlusionThreshold: 0.1, // Higher threshold
      },
    } as BotConfig;

    // Should NOT trigger with default-failing confidence
    const state1 = createMockState({
      confidence: {
        overall: 0.992, // Would fail default but passes custom
        perElement: new Map(),
      },
    });
    expect(shouldTriggerSafeAction(state1, customConfig)).toBe(false);

    // Should NOT trigger with default-failing occlusion
    const state2 = createMockState({
      confidence: {
        overall: 0.999,
        perElement: new Map([["occlusion_cards", 0.08]]), // Would fail default but passes custom
      },
    });
    expect(shouldTriggerSafeAction(state2, customConfig)).toBe(false);
  });
});
