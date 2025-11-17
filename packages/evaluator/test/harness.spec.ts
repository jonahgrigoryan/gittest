import { describe, it, expect } from "vitest";
import type { StrategyDecision } from "@poker-bot/shared";
import { EvaluationHarness } from "../src/runner/harness";

const mockDecision: StrategyDecision = {
  action: { type: "call" } as any,
  reasoning: {
    gtoRecommendation: new Map(),
    agentRecommendation: new Map(),
    blendedDistribution: new Map(),
    alpha: 0.5,
    divergence: 0,
    riskCheckPassed: true,
    sizingQuantized: false
  },
  timing: { gtoTime: 5, agentTime: 5, synthesisTime: 2, totalTime: 12 },
  metadata: { rngSeed: 42, configSnapshot: { alphaGTO: 0.5, betSizingSets: { preflop: [], flop: [], turn: [], river: [] }, divergenceThresholdPP: 30 } as any }
};

describe("EvaluationHarness", () => {
  it("runs offline hands and produces report", async () => {
    const harness = new EvaluationHarness({
      decisionProvider: {
        async nextDecision() {
          return mockDecision;
        }
      },
      metricsDir: "."
    });

    const report = await harness.run({
      runId: "test",
      config: {
        mode: "offline_smoke",
        opponents: ["tight_aggressive"],
        maxHands: 5
      }
    });
    expect(report.totalHands).toBe(5);
    expect(report.winRateBb100).toBeTypeOf("number");
  });
});
