import { describe, it, expect } from "vitest";
import { AgentSchemaValidator } from "../src/schema";

const schema = {
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

const baseContext = {
  agentId: "agent-1",
  personaId: "gto_purist",
  latencyMs: 120,
  tokenUsage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
  costUsd: 0.0025
};

describe("AgentSchemaValidator", () => {
  it("validates well-formed agent output", () => {
    const validator = new AgentSchemaValidator(schema);
    const raw = JSON.stringify({
      action: "call",
      confidence: 0.72,
      reasoning: "Pot odds justify a call.",
      sizing: 0
    });

    const result = validator.validate({ ...baseContext, raw });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.action).toBe("call");
      expect(result.data.confidence).toBeCloseTo(0.72, 2);
      expect(result.data.costUsd).toBeCloseTo(baseContext.costUsd ?? 0);
    }
  });

  it("returns parse error for malformed JSON", () => {
    const validator = new AgentSchemaValidator(schema);
    const result = validator.validate({ ...baseContext, raw: "not-json" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("Failed to parse");
    }
  });

  it("returns validation error when schema requirements fail", () => {
    const validator = new AgentSchemaValidator(schema);
    const raw = JSON.stringify({
      action: "raise",
      reasoning: "Let's apply pressure"
    });

    const result = validator.validate({ ...baseContext, raw });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("schema validation");
      expect(result.error.schemaErrors?.some(msg => msg.includes("confidence"))).toBe(true);
    }
  });
});
