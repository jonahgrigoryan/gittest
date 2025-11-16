import { describe, expect, it, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  LogLevel,
  type HandRecord,
  type SerializedGameState,
  type SerializedStrategyDecision
} from "@poker-bot/shared";
import { StructuredLogger } from "../src/structuredLogger";
import type { LogSink } from "../src/sinks/types";
import { ObservabilityReporter } from "../src/observabilityReporter";

const noopSink: LogSink = {
  name: "memory",
  level: LogLevel.DEBUG,
  publish: async () => {}
};

function createHandRecord(): HandRecord {
  const state: SerializedGameState = {
    handId: "hand-1",
    gameType: "NLHE_6max",
    blinds: { small: 1, big: 2 },
    positions: { hero: "BTN" } as any,
    players: [
      { position: "BTN" as const, stack: 100 }
    ],
    communityCards: [],
    pot: 0,
    street: "preflop",
    actionHistory: [],
    legalActions: [],
    confidence: { overall: 1, perElement: {} },
    latency: 0
  };
  const decision: SerializedStrategyDecision = {
    action: { type: "fold" },
    reasoning: {
      gtoRecommendation: [],
      agentRecommendation: [],
      blendedDistribution: [],
      alpha: 0.7,
      divergence: 0,
      riskCheckPassed: true,
      sizingQuantized: false
    },
    timing: {
      gtoTime: 10,
      agentTime: 5,
      synthesisTime: 3,
      totalTime: 18
    },
    metadata: {
      rngSeed: 1,
      configHash: "hash"
    }
  };
  return {
    handId: "hand-1",
    sessionId: "session-1",
    createdAt: Date.now(),
    rawGameState: state,
    decision,
    timing: decision.timing,
    metadata: {
      configHash: "hash",
      rngSeed: 1,
      redactionApplied: false
    }
  };
}

describe("ObservabilityReporter", () => {
  let tempDir: string;
  let metricsPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "obs-metrics-"));
    metricsPath = path.join(tempDir, "metrics.json");
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("records decisions and flushes snapshots to disk", async () => {
    const logger = new StructuredLogger({
      sessionId: "session-1",
      baseComponent: "root",
      level: LogLevel.DEBUG,
      sinks: [noopSink]
    });

    const reporter = new ObservabilityReporter({
      sessionId: "session-1",
      metricsConfig: {
        flushIntervalMs: 1000,
        maxRecentHands: 5,
        emitHandSummaries: true
      },
      structuredLogger: logger,
      metricsFilePath: metricsPath
    });

    const record = createHandRecord();
    reporter.recordDecision(record);
    reporter.recordAgentTelemetry({ totalTokens: 100, totalCostUsd: 1 });
    reporter.recordSafeMode(true);
    reporter.recordPanicStop();
    reporter.recordExecutionResult(true);

    const snapshot = await reporter.flush();
    expect(snapshot).toBeTruthy();
    const serialized = JSON.parse(await fs.readFile(metricsPath, "utf-8"));
    expect(serialized.sessionId).toBe("session-1");
    expect(serialized.recentHands).toHaveLength(1);
  });
});
