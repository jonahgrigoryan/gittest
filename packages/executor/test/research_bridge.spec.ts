import { describe, it, expect, vi } from "vitest";
import { ResearchUIExecutor } from "../src/research_bridge";
import { WindowManager } from "../src/window_manager";
import { ComplianceChecker } from "../src/compliance";
import type { StrategyDecision } from "@poker-bot/shared";

const baseDecision: StrategyDecision = {
  action: {
    type: "fold",
    position: "BTN",
    street: "flop"
  },
  reasoning: {
    gtoRecommendation: new Map(),
    agentRecommendation: new Map(),
    blendedDistribution: new Map(),
    alpha: 0.7,
    divergence: 0,
    riskCheckPassed: true,
    sizingQuantized: false
  },
  timing: {
    gtoTime: 0,
    agentTime: 0,
    synthesisTime: 0,
    totalTime: 0
  },
  metadata: {
    rngSeed: 1,
    configSnapshot: {
      alphaGTO: 0.7,
      betSizingSets: {
        preflop: [0.5],
        flop: [0.5],
        turn: [0.5],
        river: [0.5]
      },
      divergenceThresholdPP: 30
    }
  }
};

describe("ResearchUIExecutor", () => {
  it("halts execution when compliance checker blocks", async () => {
    const windowManager = new WindowManager({
      titlePatterns: ["poker"],
      processNames: [],
      minWindowSize: { width: 800, height: 600 }
    }, console);

    const checker = new ComplianceChecker({
      allowlist: [],
      prohibitedSites: [],
      requireBuildFlag: true
    }, console);

    const validateSpy = vi.spyOn(checker, "validateExecution").mockResolvedValue(false);
    const executor = new ResearchUIExecutor(windowManager, checker, undefined, console);

    const result = await executor.execute(baseDecision, { verifyAction: false });
    expect(validateSpy).toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain("Compliance");
  });
});

