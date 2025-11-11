import { describe, it, expect } from "vitest";
import type { ActionKey } from "@poker-bot/shared";
import { DivergenceDetector } from "../../src/strategy/divergence";
import type { StrategyConfig } from "../../src/strategy/types";

function createConfig(thresholdPP = 30): StrategyConfig {
  return {
    alphaGTO: 0.6,
    betSizingSets: {
      preflop: [0.5, 1.0],
      flop: [0.33, 0.5],
      turn: [0.5, 1.0],
      river: [0.5, 1.0]
    },
    divergenceThresholdPP: thresholdPP
  };
}

function map(obj: Record<string, number>): Map<ActionKey, number> {
  return new Map(Object.entries(obj) as [ActionKey, number][]);
}

describe("DivergenceDetector", () => {
  it("computes zero divergence for identical distributions", () => {
    const detector = new DivergenceDetector(createConfig(), console);
    const dist = map({ FOLD: 0.2, CALL: 0.3, RAISE: 0.5 });
    const d = detector.computeDivergence(dist, dist);
    expect(d).toBeCloseTo(0, 6);
  });

  it("computes correct total variation distance in percentage points", () => {
    const detector = new DivergenceDetector(createConfig(), console);
    const a = map({ FOLD: 0.5, CALL: 0.5 });
    const b = map({ FOLD: 0.0, CALL: 1.0 });
    // TV = 0.5 * (|0.5-0| + |0.5-1|) = 0.5; in PP => 50
    const d = detector.computeDivergence(a, b);
    expect(d).toBeCloseTo(50, 6);
  });

  it("shouldLogDivergence respects configured threshold", () => {
    const detector = new DivergenceDetector(createConfig(30), console);
    expect(detector.shouldLogDivergence(10)).toBe(false);
    expect(detector.shouldLogDivergence(30)).toBe(false);
    expect(detector.shouldLogDivergence(31)).toBe(true);
  });

  it("formatDivergenceLog includes top actions and metadata", () => {
    const detector = new DivergenceDetector(createConfig(30), console);
    const gto = map({ FOLD: 0.1, CALL: 0.2, RAISE: 0.7 });
    const agent = map({ FOLD: 0.6, CALL: 0.3, RAISE: 0.1 });
    const divergence = detector.computeDivergence(gto, agent);
    const log = detector.formatDivergenceLog({
      handId: "hand_div",
      gto,
      agent,
      divergencePP: divergence,
      alpha: 0.6,
      rngSeed: 42,
      modelHashes: { test: "hash" }
    });

    expect(log.type).toBe("strategy_divergence");
    expect(log.handId).toBe("hand_div");
    expect(log.divergence).toBeCloseTo(divergence, 6);
    expect(log.gtoTopActions.length).toBeGreaterThan(0);
    expect(log.agentTopActions.length).toBeGreaterThan(0);
    expect(log.rngSeed).toBe(42);
  });
});
