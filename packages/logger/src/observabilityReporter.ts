import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { LogLevel } from "@poker-bot/shared";
import type { MetricsSnapshot, HandRecord } from "@poker-bot/shared";
import type { config } from "@poker-bot/shared";
import { StructuredLogger } from "./structuredLogger";
import { MetricsCollector } from "./metrics";

export interface ObservabilityReporterOptions {
  sessionId: string;
  metricsConfig: config.ObservabilityMetricsConfig;
  structuredLogger: StructuredLogger;
  metricsFilePath: string;
}

interface RecentHandSummary {
  handId: string;
  totalTime: number;
  fallbackReason?: string;
  action: string;
}

export class ObservabilityReporter {
  private readonly metrics: MetricsCollector;
  private readonly recentHands: RecentHandSummary[] = [];
  private readonly includeHandSummaries: boolean;
  private flushTimer?: NodeJS.Timeout;

  constructor(private readonly options: ObservabilityReporterOptions) {
    this.metrics = new MetricsCollector({
      enabled: true,
      windowHands: options.metricsConfig.maxRecentHands
    });
    this.includeHandSummaries = options.metricsConfig.emitHandSummaries;
  }

  start() {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.options.metricsConfig.flushIntervalMs);
  }

  stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  recordDecision(hand: HandRecord) {
    this.metrics.record(hand);
    if (this.includeHandSummaries) {
      this.recentHands.push({
        handId: hand.handId,
        totalTime: hand.decision.timing.totalTime,
        fallbackReason: hand.decision.reasoning.fallbackReason,
        action: hand.decision.action.type
      });
      while (this.recentHands.length > this.options.metricsConfig.maxRecentHands) {
        this.recentHands.shift();
      }
    }
  }

  recordAgentTelemetry(summary: { totalTokens?: number; totalCostUsd?: number }) {
    this.metrics.recordAgentCost(summary);
  }

  recordSafeMode(active: boolean) {
    this.metrics.recordSafeMode(active);
  }

  recordPanicStop() {
    this.metrics.recordPanicStop();
  }

  recordSolverTimeout(durationMs?: number) {
    this.metrics.recordSolverTimeout(durationMs);
  }

  recordExecutionResult(success: boolean) {
    this.metrics.recordExecutionResult(success);
  }

  async flush(): Promise<MetricsSnapshot | null> {
    const snapshot = this.metrics.snapshot(this.options.sessionId);
    const payload = this.includeHandSummaries
      ? { ...snapshot, recentHands: [...this.recentHands] }
      : snapshot;
    await this.persistSnapshot(payload);
    this.options.structuredLogger.log(
      LogLevel.INFO,
      "metrics_snapshot",
      { snapshot: payload },
      { component: "observability.metrics" }
    );
    return snapshot;
  }

  private async persistSnapshot(
    snapshot: MetricsSnapshot | (MetricsSnapshot & { recentHands: RecentHandSummary[] })
  ) {
    const dir = path.dirname(this.options.metricsFilePath);
    await mkdir(dir, { recursive: true });
    await writeFile(this.options.metricsFilePath, JSON.stringify(snapshot, null, 2), "utf-8");
  }
}
