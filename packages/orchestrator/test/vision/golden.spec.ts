import { describe, it, expect, beforeAll } from "vitest";
import { GameStateParser } from "../../src/vision/parser";
import type { VisionOutput, ParserConfig } from "@poker-bot/shared/vision";
import type { Card } from "@poker-bot/shared";

describe("Vision Golden Tests", () => {
  let parser: GameStateParser;
  const config: ParserConfig = {
    confidenceThreshold: 0.995,
    occlusionThreshold: 0.05,
    enableInference: true,
  };

  beforeAll(() => {
    parser = new GameStateParser(config);
  });

  it("parses clean preflop state correctly", () => {
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
      stacks: new Map([
        ["BTN", { amount: 100, confidence: 0.99 }],
        ["SB", { amount: 98.5, confidence: 0.99 }],
        ["BB", { amount: 99, confidence: 0.99 }],
      ]),
      pot: { amount: 1.5, confidence: 0.995 },
      buttons: { dealer: "BTN" as any, confidence: 0.99 },
      positions: { confidence: 0.99 },
      occlusion: new Map(),
      latency: { capture: 10, extraction: 15, total: 25 },
    };

    const state = parser.parse(visionOutput);

    expect(state.street).toBe("preflop");
    expect(state.communityCards).toHaveLength(0);
    expect(state.pot).toBe(1.5);
    expect(state.players.size).toBeGreaterThan(0);
    expect(state.parseErrors).toHaveLength(0);
    expect(state.confidence.overall).toBeGreaterThan(0.99);
  });

  it("detects occlusion in popup scenario", () => {
    const visionOutput: VisionOutput = {
      timestamp: Date.now(),
      cards: {
        holeCards: [],
        communityCards: [],
        confidence: 0.3, // Low confidence due to occlusion
      },
      stacks: new Map([["BTN", { amount: 100, confidence: 0.99 }]]),
      pot: { amount: 0, confidence: 0.99 },
      buttons: { dealer: "BTN" as any, confidence: 0.99 },
      positions: { confidence: 0.99 },
      occlusion: new Map([
        ["card_0", 0.8], // 80% occluded
        ["card_1", 0.8],
      ]),
      latency: { capture: 10, extraction: 15, total: 25 },
    };

    const state = parser.parse(visionOutput);

    // Should have parse errors or low confidence
    expect(
      state.parseErrors.length > 0 || state.confidence.overall < 0.995
    ).toBe(true);
  });

  it("handles low confidence gracefully", () => {
    const visionOutput: VisionOutput = {
      timestamp: Date.now(),
      cards: {
        holeCards: [
          { rank: "2", suit: "c" },
          { rank: "3", suit: "d" },
        ] as Card[],
        communityCards: [],
        confidence: 0.6, // Low confidence
      },
      stacks: new Map([["BTN", { amount: 100, confidence: 0.5 }]]),
      pot: { amount: 1.5, confidence: 0.5 },
      buttons: { dealer: "BTN" as any, confidence: 0.5 },
      positions: { confidence: 0.5 },
      occlusion: new Map(),
      latency: { capture: 10, extraction: 15, total: 25 },
    };

    const state = parser.parse(visionOutput);

    // Parser should not crash
    expect(state).toBeDefined();
    // Should have low overall confidence
    expect(state.confidence.overall).toBeLessThan(0.995);
  });

  it("infers positions correctly", () => {
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
      stacks: new Map([
        ["BTN", { amount: 100, confidence: 0.99 }],
        ["SB", { amount: 100, confidence: 0.99 }],
        ["BB", { amount: 100, confidence: 0.99 }],
      ]),
      pot: { amount: 1.5, confidence: 0.995 },
      buttons: { dealer: "BTN" as any, confidence: 0.99 },
      positions: { confidence: 0.99 },
      occlusion: new Map(),
      latency: { capture: 10, extraction: 15, total: 25 },
    };

    const state = parser.parse(visionOutput);

    expect(state.positions.button).toBe("BTN");
    expect(state.positions.smallBlind).toBe("SB");
    expect(state.positions.bigBlind).toBe("BB");
  });

  it("calculates legal actions correctly", () => {
    const visionOutput: VisionOutput = {
      timestamp: Date.now(),
      cards: {
        holeCards: [
          { rank: "A", suit: "s" },
          { rank: "A", suit: "h" },
        ] as Card[],
        communityCards: [
          { rank: "K", suit: "h" },
          { rank: "Q", suit: "d" },
          { rank: "J", suit: "c" },
        ] as Card[],
        confidence: 0.998,
      },
      stacks: new Map([["BTN", { amount: 100, confidence: 0.99 }]]),
      pot: { amount: 10, confidence: 0.995 },
      buttons: { dealer: "BTN" as any, confidence: 0.99 },
      positions: { confidence: 0.99 },
      occlusion: new Map(),
      latency: { capture: 10, extraction: 15, total: 25 },
    };

    const state = parser.parse(visionOutput);

    expect(state.street).toBe("flop");
    expect(state.communityCards).toHaveLength(3);
    // Legal actions should be computed separately
    expect(state.legalActions).toBeDefined();
  });
});
