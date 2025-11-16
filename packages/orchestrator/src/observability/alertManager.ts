import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import {
  LogLevel,
  shouldLog,
  type MetricsSnapshot,
  type StructuredLogEvent,
  type config
} from "@poker-bot/shared";
import type { AlertConsumer, ObservabilityService } from "./service";

interface AlertState {
  lastTriggeredAt: number;
}

type TriggerId = keyof config.ObservabilityAlertsConfig["triggers"];

const triggerLevels: Record<TriggerId, LogLevel> = {
  panicStop: LogLevel.CRITICAL,
  safeMode: LogLevel.WARN,
  solverTimeouts: LogLevel.WARN,
  agentCost: LogLevel.WARN,
  healthDegradedMs: LogLevel.WARN
};

export class AlertManager implements AlertConsumer {
  private readonly state = new Map<string, AlertState>();

  constructor(
    private alertsConfig: config.ObservabilityAlertsConfig,
    private readonly service: ObservabilityService,
    private readonly logger: Pick<Console, "warn" | "error"> = console
  ) {}

  updateConfig(next: config.ObservabilityAlertsConfig) {
    this.alertsConfig = next;
  }

  handleEvent(event: StructuredLogEvent): void {
    if (!this.alertsConfig.enabled) {
      return;
    }
    if (event.event === "panic_stop_triggered") {
      void this.dispatch("panicStop", event.payload);
    } else if (event.event === "safe_mode_entered") {
      void this.dispatch("safeMode", event.payload);
    }
  }

  handleSnapshot(snapshot: MetricsSnapshot): void {
    if (!this.alertsConfig.enabled) {
      return;
    }
    const { triggers } = this.alertsConfig;
    if (
      triggers.agentCost?.enabled &&
      triggers.agentCost.threshold !== undefined &&
      snapshot.totals.agentCostUsd >= triggers.agentCost.threshold
    ) {
      void this.dispatch("agentCost", snapshot.totals);
    }
    if (
      triggers.solverTimeouts?.enabled &&
      triggers.solverTimeouts.threshold !== undefined &&
      snapshot.totals.solverTimeouts >= triggers.solverTimeouts.threshold
    ) {
      void this.dispatch("solverTimeouts", {
        solverTimeouts: snapshot.totals.solverTimeouts,
        windowHands: triggers.solverTimeouts.windowHands
      });
    }
    if (triggers.safeMode?.enabled && snapshot.safeMode?.active) {
      void this.dispatch("safeMode", snapshot.safeMode);
    }
    if (triggers.panicStop?.enabled && snapshot.totals.panicStops > 0) {
      void this.dispatch("panicStop", snapshot.totals);
    }
  }

  private async dispatch(triggerId: TriggerId, payload: unknown) {
    const triggerConfig = this.alertsConfig.triggers[triggerId];
    if (!triggerConfig?.enabled) {
      return;
    }
    const now = Date.now();
    const cooldownMs = triggerConfig.cooldownMs ?? this.alertsConfig.cooldownMs;
    const state = this.state.get(triggerId) ?? { lastTriggeredAt: 0 };
    if (now - state.lastTriggeredAt < cooldownMs) {
      this.service.log(LogLevel.DEBUG, "alert_suppressed", { triggerId, payload }, "observability.alerts");
      return;
    }
    state.lastTriggeredAt = now;
    this.state.set(triggerId, state);
    const level = triggerLevels[triggerId] ?? LogLevel.WARN;
    this.service.log(level, "alert_dispatched", { triggerId, payload }, "observability.alerts");
    await this.notifyChannels(level, triggerId, payload);
  }

  private async notifyChannels(level: LogLevel, triggerId: string, payload: unknown) {
    const channels = this.alertsConfig.channels ?? [];
    const tasks = channels
      .filter(channel => channel.enabled)
      .map(async channel => {
        const channelLevel = (channel.level as LogLevel | undefined) ?? LogLevel.INFO;
        if (!shouldLog(level, channelLevel)) {
          return;
        }
        const body = JSON.stringify({
          triggerId,
          level,
          payload,
          timestamp: Date.now()
        });
        try {
          if (channel.type === "console") {
            this.logger.warn?.(`[alert:${triggerId}] ${body}`);
          } else if (channel.type === "file" && channel.path) {
            const resolved = path.resolve(channel.path);
            await mkdir(path.dirname(resolved), { recursive: true });
            await appendFile(resolved, `${body}\n`, "utf-8");
          } else if (channel.type === "webhook" && channel.url) {
            await fetch(channel.url, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...(channel.headers ?? {})
              },
              body
            });
          }
        } catch (error) {
          this.logger.error?.("Alert channel dispatch failed", error);
        }
      });
    await Promise.allSettled(tasks);
  }
}
