import { describe, it, expect, beforeAll } from "vitest";
import { GameStateParser } from "../../src/vision/parser";
import { shouldTriggerSafeAction } from "../../src/safety/safe-action";
import type { VisionOutput, ParserConfig } from "@poker-bot/shared/vision";
import type { BotConfig, Card } from "@poker-bot/shared";

describe("Confidence Scoring Tests", () => {
  let parser: GameStateParser;
  const config: ParserConfig = {
    confidenceThreshold: 0.995,
    occlusionThreshold: 0.05,
    enableInference: true,
  };

  const botConfig: BotConfig = {
    vision: {
      confidenceThreshold: 0.995,
      occlusionThreshold: 0.05,
    },
  } as BotConfig;

  beforeAll(() => {
    parser = new GameStateParser(config);
  });

  it("calculates per-element confidence correctly", () => {
    const visionOutput: VisionOutput = {
      timestamp: Date.now(),
      cards: {
        holeCards: [
          { rank: "A", suit: "h" },
          { rank: "K", suit: "d" },
        ] as Card[],
        communityCards: [],
        confidence: 0.998,
      },
      stacks: new Map([["BTN", { amount: 100, confidence: 0.99 }]]),
      pot: { amount: 1.5, confidence: 0.995 },
      buttons: { dealer: "BTN" as any, confidence: 0.99 },
      positions: { confidence: 0.99 },
      occlusion: new Map(),
      latency: { capture: 10, extraction: 15, total: 25 },
    };

    const state = parser.parse(visionOutput);

    expect(state.confidence.perElement.size).toBeGreaterThan(0);
    expect(state.confidence.perElement.get("cards")).toBe(0.998);
    expect(state.confidence.perElement.get("pot")).toBe(0.995);
  });

  it("triggers SafeAction when confidence below threshold", () => {
    const visionOutput: VisionOutput = {
      timestamp: Date.now(),
      cards: {
        holeCards: [
          { rank: "2", suit: "c" },
          { rank: "3", suit: "d" },
        ] as Card[],
        communityCards: [],
        confidence: 0.99, // Below 0.995 threshold
      },
      stacks: new Map([["BTN", { amount: 100, confidence: 0.99 }]]),
      pot: { amount: 1.5, confidence: 0.99 },
      buttons: { dealer: "BTN" as any, confidence: 0.99 },
      positions: { confidence: 0.99 },
      occlusion: new Map(),
      latency: { capture: 10, extraction: 15, total: 25 },
    };

    const state = parser.parse(visionOutput);
    const shouldTrigger = shouldTriggerSafeAction(state, botConfig);

    expect(shouldTrigger).toBe(true);
  });

  it("does not trigger SafeAction when confidence above threshold", () => {
    const visionOutput: VisionOutput = {
      timestamp: Date.now(),
      cards: {
        holeCards: [
          { rank: "A", suit: "h" },
          { rank: "K", suit: "h" },
        ] as Card[],
        communityCards: [],
        confidence: 0.998,
      },
      stacks: new Map([["BTN", { amount: 100, confidence: 0.999 }]]),
      pot: { amount: 1.5, confidence: 0.997 },
      buttons: { dealer: "BTN" as any, confidence: 0.998 },
      positions: { confidence: 0.998 },
      occlusion: new Map(),
      latency: { capture: 10, extraction: 15, total: 25 },
    };

    const state = parser.parse(visionOutput);
    const shouldTrigger = shouldTriggerSafeAction(state, botConfig);

    expect(shouldTrigger).toBe(false);
  });
});
