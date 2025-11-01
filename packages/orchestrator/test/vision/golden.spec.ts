import { describe, expect, it } from "vitest";

import type { Street } from "@poker-bot/shared";
import type { vision } from "@poker-bot/shared";

import { GameStateParser } from "../../src/vision/parser";
import { createBotConfig } from "../utils/factories";

interface Scenario {
  name: string;
  input: vision.VisionOutput;
  expected: {
    street: Street;
    pot: number;
    heroStack: number;
    safeActionTriggered?: boolean;
  };
}

const baseStacks = {
  BTN: { amount: 110, confidence: 0.95 },
  SB: { amount: 95, confidence: 0.96 },
  BB: { amount: 98, confidence: 0.96 },
  UTG: { amount: 120, confidence: 0.9 },
  MP: { amount: 105, confidence: 0.9 },
  CO: { amount: 102, confidence: 0.9 }
};

const scenarios: Scenario[] = [
  {
    name: "clean preflop state",
    input: {
      timestamp: 1,
      cards: {
        holeCards: [
          { rank: "A", suit: "h" },
          { rank: "K", suit: "s" }
        ],
        communityCards: [],
        confidence: 0.99
      },
      stacks: { ...baseStacks },
      pot: { amount: 3, confidence: 0.95 },
      buttons: { dealer: "BTN", confidence: 0.92 },
      positions: { confidence: 0.9 },
      occlusion: { hero: 0 },
      latency: { capture: 5, extraction: 7, total: 12 }
    },
    expected: { street: "preflop", pot: 3, heroStack: 95, safeActionTriggered: false }
  },
  {
    name: "flop multiway",
    input: {
      timestamp: 2,
      cards: {
        holeCards: [
          { rank: "Q", suit: "h" },
          { rank: "Q", suit: "c" }
        ],
        communityCards: [
          { rank: "J", suit: "d" },
          { rank: "9", suit: "s" },
          { rank: "2", suit: "h" }
        ],
        confidence: 0.97
      },
      stacks: {
        ...baseStacks,
        SB: { amount: 88, confidence: 0.92 }
      },
      pot: { amount: 15, confidence: 0.92 },
      buttons: { dealer: "CO", confidence: 0.88 },
      positions: { confidence: 0.85 },
      occlusion: {},
      latency: { capture: 6, extraction: 8, total: 14 }
    },
    expected: { street: "flop", pot: 15, heroStack: 88, safeActionTriggered: false }
  },
  {
    name: "turn bet facing",
    input: {
      timestamp: 3,
      cards: {
        holeCards: [
          { rank: "A", suit: "d" },
          { rank: "J", suit: "d" }
        ],
        communityCards: [
          { rank: "A", suit: "c" },
          { rank: "7", suit: "h" },
          { rank: "4", suit: "s" },
          { rank: "2", suit: "d" }
        ],
        confidence: 0.95
      },
      stacks: {
        ...baseStacks,
        SB: { amount: 75, confidence: 0.9 }
      },
      pot: { amount: 25, confidence: 0.9 },
      buttons: { dealer: "MP", confidence: 0.85 },
      positions: { confidence: 0.85 },
      occlusion: {},
      latency: { capture: 6, extraction: 9, total: 15 }
    },
    expected: { street: "turn", pot: 25, heroStack: 75, safeActionTriggered: false }
  },
  {
    name: "river all-in",
    input: {
      timestamp: 4,
      cards: {
        holeCards: [
          { rank: "8", suit: "h" },
          { rank: "7", suit: "h" }
        ],
        communityCards: [
          { rank: "Q", suit: "h" },
          { rank: "T", suit: "h" },
          { rank: "3", suit: "c" },
          { rank: "2", suit: "s" },
          { rank: "4", suit: "h" }
        ],
        confidence: 0.94
      },
      stacks: {
        ...baseStacks,
        SB: { amount: 0, confidence: 0.95 }
      },
      pot: { amount: 120, confidence: 0.93 },
      buttons: { dealer: "BTN", confidence: 0.9 },
      positions: { confidence: 0.88 },
      occlusion: {},
      latency: { capture: 5, extraction: 7, total: 12 }
    },
    expected: { street: "river", pot: 120, heroStack: 0, safeActionTriggered: false }
  },
  {
    name: "occlusion popup",
    input: {
      timestamp: 5,
      cards: {
        holeCards: [
          { rank: "K", suit: "d" },
          { rank: "J", suit: "c" }
        ],
        communityCards: [],
        confidence: 0.93
      },
      stacks: { ...baseStacks },
      pot: { amount: 2, confidence: 0.9 },
      buttons: { dealer: "BTN", confidence: 0.9 },
      positions: { confidence: 0.88 },
      occlusion: { hero: 0.12 },
      latency: { capture: 5, extraction: 7, total: 12 }
    },
    expected: { street: "preflop", pot: 2, heroStack: 95, safeActionTriggered: true }
  },
  {
    name: "low confidence scenario",
    input: {
      timestamp: 6,
      cards: {
        holeCards: [
          { rank: "4", suit: "c" },
          { rank: "4", suit: "d" }
        ],
        communityCards: [],
        confidence: 0.6
      },
      stacks: {
        BTN: { amount: 110, confidence: 0.6 },
        SB: { amount: 95, confidence: 0.6 },
        BB: { amount: 98, confidence: 0.6 }
      },
      pot: { amount: 3, confidence: 0.5 },
      buttons: { dealer: "BTN", confidence: 0.5 },
      positions: { confidence: 0.5 },
      occlusion: {},
      latency: { capture: 5, extraction: 7, total: 12 }
    },
    expected: { street: "preflop", pot: 3, heroStack: 95, safeActionTriggered: true }
  }
];

describe("Vision Golden Tests", () => {
  const parser = new GameStateParser({
    confidenceThreshold: 0.995,
    occlusionThreshold: 0.05,
    enableInference: true
  });
  const botConfig = createBotConfig();

  scenarios.forEach(({ name, input, expected }) => {
    it(`parses ${name}`, () => {
      const state = parser.parseWithSafety(input, botConfig);
      expect(state.street).toBe(expected.street);
      expect(state.pot).toBeCloseTo(expected.pot);

      const heroInfo = state.players.get(state.positions.hero);
      expect(heroInfo?.stack).toBeCloseTo(expected.heroStack);

      if (expected.safeActionTriggered) {
        expect(state.safeActionTriggered).toBe(true);
      } else {
        expect(state.safeActionTriggered ?? false).toBe(false);
      }

      expect(state.parseErrors).toEqual([]);
    });
  });
});
