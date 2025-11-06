import { describe, it, expect, vi, afterEach } from "vitest";
import { AgentTelemetryLogger } from "../src/telemetry/logger";

describe("AgentTelemetryLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts reasoning when verbose logging disabled", () => {
    const logger = new AgentTelemetryLogger(false);
    const spy = vi.spyOn(console, "info").mockImplementation(() => {
      /* noop */
    });

    logger.log({
      requestId: "req-1",
      outputs: [
        {
          agentId: "agent-1",
          personaId: "gto_purist",
          action: "call",
          confidence: 0.6,
          reasoning: "Sensitive reasoning",
          latencyMs: 80,
          tokenUsage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
          raw: "{}",
          metadata: { weight: 1 }
        }
      ],
      failures: [],
      distribution: new Map(),
      costSummary: { totalTokens: 30, promptTokens: 20, completionTokens: 10 },
      circuitBreaker: { consecutiveFailures: 0 },
      costGuardState: { tokensToday: 0, lastReset: Date.now(), consecutiveFailures: 0 }
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(spy.mock.calls[0][0] as string);
    expect(payload.outputs[0].reasoning).toBeUndefined();
  });
});
