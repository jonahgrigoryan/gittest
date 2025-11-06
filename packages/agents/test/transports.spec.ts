import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MockTransport, OpenAITransport } from "../src";
import type { TransportRequest } from "../src";

const BASE_REQUEST: TransportRequest = {
  agentId: "agent-1",
  personaId: "gto_purist",
  prompt: "Explain the optimal play.",
  maxTokens: 128,
  temperature: 0.3
};

describe("MockTransport", () => {
  it("returns queued response and records history", async () => {
    const transport = new MockTransport({ defaultLatencyMs: 12 });
    transport.enqueueResponse({
      raw: '{"action":"call"}',
      tokenUsage: { promptTokens: 20, completionTokens: 10 }
    });

    const result = await transport.invoke(BASE_REQUEST, new AbortController().signal);
    expect(result.raw).toBe('{"action":"call"}');
    expect(result.tokenUsage).toEqual({ promptTokens: 20, completionTokens: 10, totalTokens: 30 });
    expect(result.latencyMs).toBe(12);
    expect(transport.callHistory).toHaveLength(1);
    expect(transport.pendingResponses).toBe(0);
  });
});

describe("OpenAITransport", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      // @ts-ignore
      delete globalThis.fetch;
    }
    vi.restoreAllMocks();
  });

  it("retries once on server error and returns parsed response", async () => {
    const firstResponse = {
      ok: false,
      status: 500,
      text: async () => "server error"
    } as unknown as Response;
    const secondResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "{\"action\":\"raise\"}" },
            finish_reason: "stop"
          }
        ],
        usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 }
      })
    } as unknown as Response;

    const fetchMock = vi.fn().mockResolvedValueOnce(firstResponse).mockResolvedValueOnce(secondResponse);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const transport = new OpenAITransport({
      id: "openai-test",
      modelId: "gpt-4o-mini",
      apiKey: "test-key",
      maxRetries: 1,
      retryDelayMs: 25
    });

    const result = await transport.invoke(BASE_REQUEST, new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.raw).toBe('{"action":"raise"}');
    expect(result.tokenUsage.totalTokens).toBe(60);
    expect(result.finishReason).toBe("stop");
    expect(result.statusCode).toBe(200);
  });
});
