import path from "node:path";
import type { ObservabilityConfig } from "@poker-bot/shared";
import type { HealthSnapshot } from "@poker-bot/shared";
import type { HandRecord } from "@poker-bot/shared";
import { LogLevel, type MetricsSnapshot, type StructuredLogEvent } from "@poker-bot/shared";
import {
  StructuredLogger,
  createConsoleSink,
  createFileSink,
  createWebhookSink,
  ObservabilityReporter,
  type LogSink
} from "@poker-bot/logger";

export interface ObservabilityServiceOptions {
  sessionId: string;
  sessionDir: string;
  config: ObservabilityConfig;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export interface AlertConsumer {
  handleEvent(event: StructuredLogEvent): void;
  handleSnapshot(snapshot: MetricsSnapshot): void;
}

export class ObservabilityService {
  private structuredLogger!: StructuredLogger;
  private reporter!: ObservabilityReporter;
  private sinks: LogSink[] = [];
  private alertConsumer?: AlertConsumer;
  private options: ObservabilityServiceOptions;

  constructor(options: ObservabilityServiceOptions) {
    this.options = options;
  }

  async init() {
    await this.applyConfig(this.options.config);
  }

  async applyConfig(nextConfig: ObservabilityConfig) {
    await this.dispose();
    this.options.config = nextConfig;
    this.sinks = this.buildSinks(nextConfig);
    this.structuredLogger = new StructuredLogger({
      sessionId: this.options.sessionId,
      baseComponent: "orchestrator",
      level: nextConfig.logs.level as LogLevel,
      sinks: this.sinks
    });
    await this.structuredLogger.start();
    this.reporter = new ObservabilityReporter({
      sessionId: this.options.sessionId,
      metricsConfig: nextConfig.metrics,
      structuredLogger: this.structuredLogger,
      metricsFilePath: path.join(this.options.sessionDir, "metrics", "latest.json")
    });
    this.reporter.start();
  }

  registerAlertConsumer(consumer: AlertConsumer) {
    this.alertConsumer = consumer;
  }

  log(
    level: LogLevel,
    event: string,
    payload?: Record<string, unknown>,
    component = "orchestrator"
  ) {
    if (!this.structuredLogger) {
      return;
    }
    this.structuredLogger.log(level, event, payload, { component });
    if (this.alertConsumer) {
      const eventPayload = {
        sessionId: this.options.sessionId,
        component,
        event,
        level,
        timestamp: Date.now(),
        payload
      };
      this.alertConsumer.handleEvent(eventPayload);
    }
  }

  recordDecision(record: HandRecord) {
    this.reporter?.recordDecision(record);
  }

  recordAgentTelemetry(summary: { totalTokens?: number; totalCostUsd?: number }) {
    this.reporter?.recordAgentTelemetry(summary);
  }

  recordSafeMode(active: boolean) {
    this.reporter?.recordSafeMode(active);
    this.log(
      active ? LogLevel.WARN : LogLevel.INFO,
      active ? "safe_mode_entered" : "safe_mode_exited",
      { active }
    );
  }

  recordPanicStop(reason: string) {
    this.reporter?.recordPanicStop();
    this.log(LogLevel.CRITICAL, "panic_stop_triggered", { reason });
  }

  recordExecutionResult(success: boolean) {
    this.reporter?.recordExecutionResult(success);
    this.log(
      LogLevel.INFO,
      "execution_result",
      { success },
      "observability.execution"
    );
  }

  recordHealthSnapshot(snapshot: HealthSnapshot) {
    this.log(LogLevel.INFO, "health_snapshot", {
      snapshotId: snapshot.id,
      overall: snapshot.overall
    });
    if (snapshot.safeMode) {
      this.recordSafeMode(snapshot.safeMode.active);
    }
    if (snapshot.panicStop) {
      this.recordPanicStop(snapshot.panicStop.detail);
    }
  }

  async flush(): Promise<MetricsSnapshot | null> {
    const snapshot = await this.reporter?.flush();
    if (snapshot && this.alertConsumer) {
      this.alertConsumer.handleSnapshot(snapshot);
    }
    return snapshot ?? null;
  }

  async dispose() {
    if (this.reporter) {
      this.reporter.stop();
    }
    if (this.structuredLogger) {
      await this.structuredLogger.stop();
    }
    this.sinks = [];
  }

  private buildSinks(config: ObservabilityConfig): LogSink[] {
    const sinks: LogSink[] = [];
    if (config.logs.sinks.console?.enabled) {
      sinks.push(
        createConsoleSink({
          level: config.logs.sinks.console.level ?? config.logs.level
        })
      );
    }
    if (config.logs.sinks.file?.enabled && config.logs.sinks.file.outputDir) {
      const resolved = path.resolve(config.logs.sinks.file.outputDir);
      sinks.push(
        createFileSink({
          sessionId: this.options.sessionId,
          level: config.logs.sinks.file.level ?? config.logs.level,
          outputDir: resolved,
          maxFileSizeMb: config.logs.sinks.file.maxFileSizeMb,
          maxFiles: config.logs.sinks.file.maxFiles
        })
      );
    }
    if (config.logs.sinks.webhook?.enabled && config.logs.sinks.webhook.url) {
      sinks.push(
        createWebhookSink({
          level: config.logs.sinks.webhook.level ?? config.logs.level,
          url: config.logs.sinks.webhook.url,
          headers: config.logs.sinks.webhook.headers,
          batchSize: config.logs.sinks.webhook.batchSize,
          retry: config.logs.sinks.webhook.retry
            ? {
                attempts: config.logs.sinks.webhook.retry.attempts ?? 3,
                backoffMs: config.logs.sinks.webhook.retry.backoffMs ?? 1000
              }
            : undefined
        })
      );
    }
    return sinks;
  }
}
