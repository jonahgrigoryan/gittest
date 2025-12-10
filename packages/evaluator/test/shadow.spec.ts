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
    expect(summary.aggregates.totalHands).toBe(15);
    expect(summary.aggregates.fallbackCount).toBe(4);
    expect(summary.aggregates.safeActionCount).toBe(0);
    expect(summary.aggregates.netChips).toBe(0);
    expect(summary.fallbackReasons["gto_only"]).toBe(4);
  });
});
