import { describe, it, expect } from "vitest";
import { computeWinRateStats, createEvaluationReport, type HandMetric, type EvaluationRunConfig } from "../src/evaluation";

describe("evaluation helpers", () => {
  it("computes win rate stats", () => {
    const metrics: HandMetric[] = [
      { handId: "h1", opponentId: "opp", netChips: 2, bigBlind: 2 },
      { handId: "h2", opponentId: "opp", netChips: -1, bigBlind: 2 }
    ];
    const stats = computeWinRateStats(metrics);
    expect(stats.meanBb100).toBeCloseTo(25, 1);
    expect(stats.upper95).toBeGreaterThan(stats.lower95);
  });

  it("creates evaluation report with metadata", () => {
    const config: EvaluationRunConfig = {
      mode: "offline_smoke",
      opponents: ["opp"],
      maxHands: 2
    };
    const metrics: HandMetric[] = [
      { handId: "h1", opponentId: "opp", netChips: 4, bigBlind: 2 }
    ];
    const report = createEvaluationReport(config, metrics, {
      metricsPath: "results/eval/run1/metrics.jsonl",
      startedAt: 1000,
      completedAt: 2000,
      runId: "run-123"
    });
    expect(report.mode).toBe("offline_smoke");
    expect(report.totalHands).toBe(1);
    expect(report.runId).toBe("run-123");
    expect(report.metricsPath).toContain("metrics.jsonl");
  });
});
