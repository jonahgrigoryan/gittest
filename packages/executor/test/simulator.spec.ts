import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SimulatorExecutor } from "../src/simulators/simulator";
import type { StrategyDecision } from "@poker-bot/shared";
import type { ActionVerifier } from "../src/verifier";

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

  describe("Phase 10: Executor Error Paths", () => {
    // Scenario 3: Vision/API timeout (simulated via fetch rejection)
    it("Scenario 3: handles API timeout gracefully", async () => {
      // Deterministic mock: reject immediately to simulate timeout/error
      (globalThis.fetch as any).mockRejectedValueOnce(new Error("Simulator API timeout"));

      const executor = new SimulatorExecutor("http://localhost:9000/api");
      const result = await executor.execute(baseDecision, { timeoutMs: 1000, verifyAction: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Simulator API call failed");
      expect(result.error).toContain("Simulator API timeout");
    });

    // Scenario 5: Retry logic reaching max retries
    it("Scenario 5: retries verification exactly maxRetries times then fails", async () => {
      const mockVerifier = {
        verifyAction: vi.fn().mockResolvedValue({
          passed: false,
          mismatchReason: "State mismatch"
        })
      } as unknown as ActionVerifier;

      const executor = new SimulatorExecutor("http://localhost:9000/api", mockVerifier);

      // Stub retryExecution to call execute directly without setTimeout jitter (deterministic)
      const originalExecute = executor.execute.bind(executor);
      vi.spyOn(executor as any, "retryExecution").mockImplementation(async (decision: any, options: any) => {
        const retryOptions = {
          ...options,
          maxRetries: (options.maxRetries || 1) - 1,
          verifyAction: true
        };
        const retryResult = await originalExecute(decision, retryOptions);
        if (retryResult.verificationResult) {
          retryResult.verificationResult.retryCount = 1;
        }
        return retryResult;
      });

      // Execute with maxRetries = 2
      const result = await executor.execute(baseDecision, { 
        verifyAction: true, 
        maxRetries: 2,
        timeoutMs: 1000
      });

      // Initial attempt + 2 retries = 3 calls to API (fetch)
      // Verification happens after each successful API call
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
      expect(mockVerifier.verifyAction).toHaveBeenCalledTimes(3);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Verification failed");
      expect(result.verificationResult?.retryCount).toBe(1);
    });

    // Scenario 6: Action amount validation for raises
    it("Scenario 6: rejects invalid raise amounts early", async () => {
      const invalidDecision = { 
        ...baseDecision, 
        action: { ...baseDecision.action, amount: -10 } 
      };

      const executor = new SimulatorExecutor("http://localhost:9000/api");
      const result = await executor.execute(invalidDecision, { verifyAction: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Raise action requires positive amount");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    // Scenario 6b: NaN raise amount validation
    it("Scenario 6b: rejects NaN raise amounts", async () => {
      const nanDecision = { 
        ...baseDecision, 
        action: { ...baseDecision.action, amount: NaN } 
      };

      const executor = new SimulatorExecutor("http://localhost:9000/api");
      const result = await executor.execute(nanDecision, { verifyAction: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Raise action requires positive amount");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    // Scenario 6c: Infinity raise amount validation
    it("Scenario 6c: rejects Infinity raise amounts", async () => {
      const infDecision = { 
        ...baseDecision, 
        action: { ...baseDecision.action, amount: Infinity } 
      };

      const executor = new SimulatorExecutor("http://localhost:9000/api");
      const result = await executor.execute(infDecision, { verifyAction: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Raise action requires positive amount");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });
});
