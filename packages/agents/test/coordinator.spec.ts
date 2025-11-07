import { describe, it, expect, beforeEach } from "vitest";
import type { ConfigurationManager, GameState } from "@poker-bot/shared";
import { AgentCoordinatorService } from "../src/coordinator";
import { MockTransport } from "../src/transports/mock";
import type { PromptContext } from "../src";

const agentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "confidence", "reasoning"],
  properties: {
    action: { type: "string", enum: ["fold", "check", "call", "raise"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reasoning: { type: "string" },
    sizing: { type: "number", minimum: 0 }
  }
} as const;

const baseConfigValues = {
  "agents.models": [
    {
      name: "mock-agent",
      provider: "local",
      modelId: "mock-model",
      persona: "gto_purist",
      promptTemplate: "You are a balanced poker advisor."
    }
  ],
  "agents.timeoutMs": 100,
  "agents.outputSchema": agentSchema,
  "agents.personaOverrides": {},
  "agents.costPolicy": {
    maxTokensDecision: 500,
    maxTokensDay: 10000,
    maxLatencyMs: 500,
    consecutiveFailureThreshold: 2,
    recoveryHands: 1
  },
  "agents.circuitBreaker": {
    consecutiveFailureThreshold: 2,
    cooldownHands: 1,
    minCooldownMs: 0
  }
} satisfies Record<string, unknown>;

const sampleState: GameState = {
  handId: "H-001",
  gameType: "NLHE_6max",
  blinds: { small: 1, big: 2 },
  positions: { hero: "CO", button: "BTN", smallBlind: "SB", bigBlind: "BB" },
  players: new Map([
    ["BTN", { stack: 150 }],
    ["CO", { stack: 110, holeCards: [{ rank: "A", suit: "s" }, { rank: "K", suit: "d" }] }],
    ["SB", { stack: 40 }],
    ["BB", { stack: 60 }]
  ]),
  communityCards: [{ rank: "7", suit: "h" }, { rank: "5", suit: "d" }, { rank: "2", suit: "c" }],
  pot: 15,
  street: "flop",
  actionHistory: [
    { type: "raise", amount: 6, position: "BTN", street: "preflop" },
    { type: "call", amount: 6, position: "CO", street: "preflop" }
  ],
  legalActions: [
    { type: "fold", position: "CO", street: "flop" },
    { type: "call", position: "CO", street: "flop", amount: 6 },
    { type: "raise", position: "CO", street: "flop", amount: 18 }
  ],
  confidence: { overall: 0.998, perElement: new Map([["board", 0.997]]) },
  latency: 80
};

const promptContext: PromptContext = {
  requestId: "test-query",
  timeBudgetMs: 80,
  solverSummary: {
    recommendedAction: "call",
    confidence: 0.6,
    rationale: "Pot odds favor continuing"
  }
};

let transports: Map<string, MockTransport>;

beforeEach(() => {
  transports = new Map();
});

describe("AgentCoordinatorService", () => {
  it("produces aggregated output for valid transport responses", async () => {
    const transport = new MockTransport();
    transport.enqueueResponse({
      raw: JSON.stringify({ action: "call", confidence: 0.55, reasoning: "Maintain pot control." }),
      tokenUsage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 }
    });
    transports.set("mock-model", transport);

    const coordinator = createCoordinator(transports, baseConfigValues);
    const result = await coordinator.query(sampleState, promptContext);

    expect(result.outputs).toHaveLength(1);
    expect(result.winningAction).toBe("call");
    expect(result.droppedAgents).toBeUndefined();
    expect(result.outputs[0].metadata?.weight).toBeGreaterThan(0);
  });

  it("filters invalid agent responses and records validation failures", async () => {
    const transport = new MockTransport();
    transport.enqueueResponse({
      raw: JSON.stringify({ action: "raise", reasoning: "Aggressive line" }),
      tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    });
    transports.set("mock-model", transport);

    const coordinator = createCoordinator(transports, baseConfigValues);
    const result = await coordinator.query(sampleState, promptContext);

    expect(result.outputs).toHaveLength(0);
    expect(result.droppedAgents).toHaveLength(1);
    expect(result.droppedAgents?.[0].reason).toBe("validation");
  });

  it("marks transport failures appropriately", async () => {
    const transport = new MockTransport();
    transport.enqueueResponse({ error: new Error("network failure" ), raw: "" });
    transports.set("mock-model", transport);

    const coordinator = createCoordinator(transports, baseConfigValues);
    const result = await coordinator.query(sampleState, promptContext);

    expect(result.outputs).toHaveLength(0);
    expect(result.droppedAgents?.[0].reason).toBe("transport");
  });

  it("trips cost guard when limits are exceeded", async () => {
    const transport = new MockTransport();
    transport.enqueueResponse({
      raw: JSON.stringify({ action: "raise", confidence: 0.9, reasoning: "All-in." }),
      tokenUsage: { promptTokens: 400, completionTokens: 200, totalTokens: 600 }
    });
    transports.set("mock-model", transport);

    const coordinator = createCoordinator(transports, {
      ...baseConfigValues,
      "agents.costPolicy": {
        maxTokensDecision: 100,
        maxTokensDay: 1000,
        maxLatencyMs: 500,
        consecutiveFailureThreshold: 1,
        recoveryHands: 1
      }
    });

    const result = await coordinator.query(sampleState, promptContext);
    expect(result.circuitBreakerTripped).toBe(true);
    expect(result.notes).toContain("Cost guard");
  });

  it("trips circuit breaker after consecutive failures", async () => {
    const transport = new MockTransport();
    transports.set("mock-model", transport);

    const coordinator = createCoordinator(transports, baseConfigValues);

    transport.enqueueResponse({ raw: JSON.stringify({ action: "raise" }), tokenUsage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 } });
    const result1 = await coordinator.query(sampleState, promptContext);
    expect(result1.outputs).toHaveLength(0);

    transport.enqueueResponse({ raw: JSON.stringify({ action: "raise" }), tokenUsage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 } });
    const result2 = await coordinator.query(sampleState, promptContext);
    expect(result2.circuitBreakerTripped).toBe(true);
  });
});

function createCoordinator(
  transportMap: Map<string, MockTransport>,
  configValues: Record<string, unknown>
) {
  const configManager = {
    get<T>(key: string): T {
      if (!(key in configValues)) {
        throw new Error(`Missing config key ${key}`);
      }
      return configValues[key] as T;
    }
  } as unknown as ConfigurationManager;

  return new AgentCoordinatorService({
    configManager,
    transports: transportMap,
    now: () => Date.now()
  });
}
