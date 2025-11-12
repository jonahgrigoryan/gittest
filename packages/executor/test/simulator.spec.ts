import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SimulatorExecutor } from "../src/simulators/simulator";
import type { StrategyDecision } from "@poker-bot/shared";

const baseDecision: StrategyDecision = {
  action: {
    type: "raise",
    amount: 50,
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
    gtoTime: 10,
    agentTime: 0,
    synthesisTime: 5,
    totalTime: 15
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

describe("SimulatorExecutor", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
      status: 200,
      statusText: "OK"
    }) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("executes raise action via simulator API", async () => {
    const executor = new SimulatorExecutor("http://localhost:9000/api");
    const result = await executor.execute(baseDecision, { verifyAction: false });

    expect(result.success).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, request] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("http://localhost:9000/api/action");
    expect(JSON.parse(request.body)).toMatchObject({ action: "raise", amount: 50 });
  });

  it("fails when API responds with error status", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve("boom")
    });

    const executor = new SimulatorExecutor("http://localhost:9000/api");
    const result = await executor.execute(baseDecision, { verifyAction: false });

    expect(result.success).toBe(false);
    expect(result.error).toContain("API error");
  });
});

