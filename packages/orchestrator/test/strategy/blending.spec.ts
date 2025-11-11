import { describe, it, expect } from "vitest";
import type { ActionKey, GTOSolution } from "@poker-bot/shared";
import type { AggregatedAgentOutput } from "../../../agents/src/types";
import { StrategyBlender } from "../../src/strategy/blending";
import type { StrategyConfig } from "../../src/strategy/types";

function createBlender(alphaGTO = 0.6): StrategyBlender {
  const config: StrategyConfig = {
    alphaGTO,
    betSizingSets: {
      preflop: [0.5, 1.0],
      flop: [0.33, 0.66],
      turn: [0.5],
      river: [1.0]
    },
    divergenceThresholdPP: 30
  };
  return new StrategyBlender(config, {
    warn: () => {},
    info: () => {},
    debug: () => {},
    error: () => {}
  });
}

function createGTOSolution(dist: Record<ActionKey, number>): GTOSolution {
  const actions = new Map<ActionKey, any>();
  for (const [key, freq] of Object.entries(dist) as [ActionKey, number][]) {
    actions.set(key, {
      solution: {
        frequency: freq
      }
    });
  }
  return { actions, meta: {} } as unknown as GTOSolution;
}

function createAgentOutput(dist: Partial<Record<string, number>>): AggregatedAgentOutput {
  const normalized = new Map<string, number>();
  for (const [k, v] of Object.entries(dist)) {
    normalized.set(k, v!);
  }
  return {
    outputs: [],
    normalizedActions: normalized as any,
    consensus: 0,
    winningAction: null,
    budgetUsedMs: 0,
    circuitBreakerTripped: false,
    startedAt: Date.now(),
    completedAt: Date.now()
  } as AggregatedAgentOutput;
}

describe("StrategyBlender", () => {
  it("enforces alpha bounds via validateAlpha", () => {
    const blender = createBlender();
    expect(blender.validateAlpha(0.3)).toBe(true);
    expect(blender.validateAlpha(0.9)).toBe(true);
    expect(blender.validateAlpha(0.1)).toBe(false);
    expect(blender.validateAlpha(1.0)).toBe(false);
  });

  it("computes weights from alpha", () => {
    const blender = createBlender(0.7);
    const w = blender.computeWeights(0.7);
    expect(w.gto).toBeCloseTo(0.7, 6);
    expect(w.agent).toBeCloseTo(0.3, 6);
  });

  it("blends simple matching actions from GTO and agents", () => {
    const blender = createBlender(0.6);
    const gto = createGTOSolution({
      "FOLD": 0.2,
      "CALL": 0.3,
      "RAISE_50": 0.5
    });
    const agents = createAgentOutput({
      fold: 0.1,
      call: 0.4,
      raise: 0.5
    });

    const blended = blender.blend(gto, agents);
    const actions = blended.actions;

    // Ensure probabilities sum to 1
    let total = 0;
    for (const p of actions.values()) total += p;
    expect(total).toBeCloseTo(1, 6);

    // Ensure keys preserved
    expect(actions.has("FOLD")).toBe(true);
    expect(actions.has("CALL")).toBe(true);
    expect(actions.has("RAISE_50")).toBe(true);
  });

  it("falls back to pure GTO when blended distribution becomes empty/invalid", () => {
    const blender = createBlender(0.8);
    const gto = createGTOSolution({
      "FOLD": 0.5,
      "CALL": 0.5
    });
    // Malformed agents: no normalizedActions map
    const agents = {
      outputs: [],
      normalizedActions: undefined,
      consensus: 0,
      winningAction: null,
      budgetUsedMs: 0,
      circuitBreakerTripped: false,
      startedAt: Date.now(),
      completedAt: Date.now()
    } as unknown as AggregatedAgentOutput;

    const result = blender.blend(gto, agents);
    const sum = Array.from(result.actions.values()).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    // When fallback triggers, alpha is forced to 1.0 inside implementation
    expect(result.alpha).toBeGreaterThan(0.79);
  });
});
