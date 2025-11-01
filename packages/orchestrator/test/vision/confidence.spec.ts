import { describe, expect, it } from "vitest";

import type { vision } from "@poker-bot/shared";

import { GameStateParser } from "../../src/vision/parser";

const parser = new GameStateParser({
  confidenceThreshold: 0.995,
  occlusionThreshold: 0.05,
  enableInference: true
});

const baseOutput: vision.VisionOutput = {
  timestamp: 1,
  cards: {
    holeCards: [
      { rank: "A", suit: "s" },
      { rank: "K", suit: "d" }
    ],
    communityCards: [],
    confidence: 1
  },
  stacks: {
    BTN: { amount: 110, confidence: 1 },
    SB: { amount: 95, confidence: 1 },
    BB: { amount: 100, confidence: 1 }
  },
  pot: { amount: 3, confidence: 1 },
  buttons: { dealer: "BTN", confidence: 1 },
  positions: { confidence: 1 },
  occlusion: {},
  latency: { capture: 5, extraction: 5, total: 10 }
};

describe("Confidence aggregation", () => {
  it("calculates per-element confidence correctly", () => {
    const output: vision.VisionOutput = {
      ...baseOutput,
      cards: { ...baseOutput.cards, confidence: 0.8 },
      stacks: {
        BTN: { amount: 110, confidence: 0.7 },
        SB: { amount: 90, confidence: 0.7 }
      },
      pot: { amount: 3, confidence: 0.6 },
      buttons: { dealer: "BTN", confidence: 0.5 },
      positions: { confidence: 0.4 }
    };
    const state = parser.parse(output);
    const overall = state.confidence.overall;
    expect(overall).toBeGreaterThan(0.5);
    expect(overall).toBeLessThan(0.8);
  });

  it("maintains high confidence for strong signals", () => {
    const state = parser.parse(baseOutput);
    expect(state.confidence.overall).toBeCloseTo(1);
  });
});
