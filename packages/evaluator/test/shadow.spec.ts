import { describe, it, expect } from "vitest";
import path from "node:path";
import { runShadowEvaluation } from "../src/runner/shadow";

const fixturesDir = path.resolve(__dirname, "fixtures");

describe("shadow evaluation", () => {
  it("computes aggregates from hand records", async () => {
    const outputDir = path.join(fixturesDir, "..", "..", "results");
    const summary = await runShadowEvaluation({
      handsDir: fixturesDir,
      outputDir,
      sessionId: "test-session"
    });
    expect(summary.aggregates.totalHands).toBe(2);
    expect(summary.aggregates.fallbackCount).toBe(1);
    expect(summary.aggregates.safeActionCount).toBe(1);
    expect(summary.aggregates.netChips).toBe(15);
    expect(summary.fallbackReasons["safe_action:vision"]).toBe(1);
  });
});
