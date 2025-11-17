import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HandOutcome, HandRecord } from "@poker-bot/shared";
import { createHandHistoryLogger } from "../src/hand_history";

describe("HandHistoryLogger", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hh-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists hand records, redaction, exporters, and metrics", async () => {
    const logger = await createHandHistoryLogger({
      sessionId: "test-session",
      outputDir: dir,
      sessionPrefix: "HH",
      flushIntervalMs: 50,
      maxFileSizeMb: 1,
      retentionDays: 1,
      formats: ["json", "acpc"],
      redaction: { enabled: true, fields: ["reasoning"] },
      metrics: { enabled: true, windowHands: 50 },
      logger: console,
      evaluation: { runId: "test-run", mode: "offline_smoke" }
    });

    const record = createHandRecord();
    await logger.append(record);
    const outcome: HandOutcome = {
      handId: record.handId,
      netChips: 5,
      recordedAt: Date.now()
    };
    await logger.recordOutcome(record.handId, outcome);

    await logger.flush();
    await logger.close();

    const sessionDir = join(dir, "HH_test-session");
    const files = await readdir(sessionDir);
    const logFile = files.find(file => file.endsWith(".jsonl"));
    expect(logFile).toBeTruthy();

    const contents = await readFile(join(sessionDir, logFile!), "utf-8");
    expect(contents).toContain(record.handId);
    expect(contents).toContain('"reasoning":"[REDACTED]"');
    const [firstLine] = contents.trim().split("\n");
    const parsed = JSON.parse(firstLine);
    expect(parsed.metadata.evaluation).toEqual({ runId: "test-run", mode: "offline_smoke" });

    const exporterJson = join(sessionDir, "json", `hand_${record.handId}.json`);
    expect(await stat(exporterJson)).toBeTruthy();

    const metrics = logger.getMetrics();
    expect(metrics?.totals.handsLogged).toBeGreaterThan(0);
  });
});

function createHandRecord(): HandRecord {
  return {
    handId: "hand-1",
    sessionId: "test-session",
    createdAt: Date.now(),
    rawGameState: {
      handId: "hand-1",
      gameType: "HU_NLHE",
      blinds: { small: 1, big: 2 },
      positions: { hero: "BTN", button: "BTN", smallBlind: "SB", bigBlind: "BB" },
      players: [{ position: "BTN", stack: 100 }],
      communityCards: [],
      pot: 0,
      street: "preflop",
      actionHistory: [],
      legalActions: [],
      confidence: { overall: 1, perElement: {} },
      latency: 0
    },
    decision: {
      action: { type: "raise", position: "BTN", street: "preflop", amount: 4 },
      reasoning: {
        gtoRecommendation: [],
        agentRecommendation: [],
        blendedDistribution: [],
        alpha: 0.7,
        divergence: 0,
        riskCheckPassed: true,
        sizingQuantized: false
      },
      timing: { gtoTime: 10, agentTime: 5, synthesisTime: 3, totalTime: 18 },
      metadata: {
        rngSeed: 42,
        configHash: "hash",
        riskSnapshotId: undefined,
        modelHashes: undefined
      }
    },
    execution: undefined,
    solver: undefined,
    agents: {
      outputs: [
        {
          agentId: "agent-1",
          personaId: "persona",
          reasoning: "some reasoning",
          action: "raise",
          confidence: 0.8,
          latencyMs: 100
        }
      ] as any,
      normalizedActions: { fold: 0, check: 0, call: 0.2, raise: 0.8 } as any,
      consensus: 0.8,
      winningAction: "raise",
      budgetUsedMs: 120,
      circuitBreakerTripped: false,
      startedAt: Date.now(),
      completedAt: Date.now()
    },
    timing: { gtoTime: 10, agentTime: 5, synthesisTime: 3, totalTime: 18 },
    metadata: {
      configHash: "hash",
      redactionApplied: false
    }
  };
}
