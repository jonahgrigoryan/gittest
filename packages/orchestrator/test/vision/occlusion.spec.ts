import { describe, it, expect, beforeAll } from "vitest";
import { GameStateParser } from "../../src/vision/parser";
import { shouldTriggerSafeAction } from "../../src/safety/safe-action";
import type { VisionOutput, ParserConfig } from "@poker-bot/shared/vision";
import type { BotConfig, Card } from "@poker-bot/shared";

describe("Occlusion Detection Tests", () => {
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

  it("detects occluded ROI from low variance", () => {
    // This test would use actual image processing in production
    // For now, we test the integration with vision output
    const visionOutput: VisionOutput = {
      timestamp: Date.now(),
      cards: {
        holeCards: [],
        communityCards: [],
        confidence: 0.3,
      },
      stacks: new Map([["BTN", { amount: 100, confidence: 0.99 }]]),
      pot: { amount: 0, confidence: 0.99 },
      buttons: { dealer: "BTN" as any, confidence: 0.99 },
      positions: { confidence: 0.99 },
      occlusion: new Map([["card_roi", 0.8]]), // High occlusion
      latency: { capture: 10, extraction: 15, total: 25 },
    };

    const state = parser.parse(visionOutput);

    // Low confidence due to occlusion
    expect(state.confidence.overall).toBeLessThan(0.995);
  });

  it("does not flag normal cards as occluded", () => {
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
      occlusion: new Map([["card_roi", 0.01]]), // Low occlusion
      latency: { capture: 10, extraction: 15, total: 25 },
    };

    const state = parser.parse(visionOutput);

    // Should have high confidence
    expect(state.confidence.overall).toBeGreaterThan(0.99);
  });

  it("triggers SafeAction when occlusion exceeds threshold", () => {
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
      occlusion: new Map([["occlusion_card_roi", 0.1]]), // 10% > 5% threshold
      latency: { capture: 10, extraction: 15, total: 25 },
    };

    const state = parser.parse(visionOutput);
    const shouldTrigger = shouldTriggerSafeAction(state, botConfig);

    expect(shouldTrigger).toBe(true);
  });
});
