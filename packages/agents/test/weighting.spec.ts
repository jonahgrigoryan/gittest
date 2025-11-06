import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { computeWeights, createDefaultSnapshot, updateWeightSnapshot } from "../src/weighting/engine";
import { loadWeightSnapshot, saveWeightSnapshot } from "../src/weighting/storage";
import type { AgentOutput, WeightSnapshot, BrierSample } from "../src";

describe("weighting engine", () => {
  it("falls back to default weight when history is missing", () => {
    const snapshot = createDefaultSnapshot();
    const outputs: AgentOutput[] = [
      buildOutput("agent-1", "call", 0.8),
      buildOutput("agent-2", "raise", 0.6)
    ];

    const weights = computeWeights(outputs, snapshot);
    expect(weights.get("agent-1")).toBeCloseTo(1);
    expect(weights.get("agent-2")).toBeCloseTo(1);
  });

  it("updates weights based on Brier samples", () => {
    let snapshot: WeightSnapshot = createDefaultSnapshot();
    const samples: BrierSample[] = [
      { agentId: "agent-1", personaId: "gto_purist", predicted: 0.7, outcome: 1, weight: 1, timestamp: Date.now() },
      { agentId: "agent-1", personaId: "gto_purist", predicted: 0.8, outcome: 0, weight: 1, timestamp: Date.now() }
    ];

    snapshot = updateWeightSnapshot(snapshot, samples);
    const entry = snapshot.entries["agent-1"];
    expect(entry).toBeDefined();
    expect(entry.weight).toBeGreaterThan(0);
    expect(entry.sampleCount).toBeGreaterThan(0);
  });
});

describe("weight snapshot storage", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "weights-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("persists and reloads weight snapshots", async () => {
    const snapshot: WeightSnapshot = {
      ...createDefaultSnapshot(),
      entries: {
        "agent-1": {
          agentId: "agent-1",
          personaId: "gto_purist",
          weight: 0.75,
          brierScore: 0.21,
          sampleCount: 4,
          updatedAt: Date.now()
        }
      }
    };

    const filePath = path.join(tempDir, "weights.json");
    await saveWeightSnapshot(snapshot, filePath);
    const reloaded = await loadWeightSnapshot(filePath);
    expect(reloaded.entries["agent-1"].weight).toBeCloseTo(0.75);
  });
});

function buildOutput(agentId: string, action: "call" | "raise" | "fold" | "check", confidence: number): AgentOutput {
  return {
    agentId,
    personaId: "persona",
    action,
    confidence,
    reasoning: "",
    latencyMs: 10,
    tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    raw: "{}"
  };
}
