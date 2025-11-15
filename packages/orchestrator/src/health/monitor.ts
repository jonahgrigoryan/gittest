import { randomUUID } from "node:crypto";
import {
  computeOverallHealth,
  type HealthCheckDefinition,
  type HealthSnapshot,
  type HealthStatus
} from "@poker-bot/shared";
import type { HealthMonitoringConfig } from "@poker-bot/shared/src/config/types";
import { SafeModeController } from "./safeModeController";
import { PanicStopController } from "./panicStopController";

interface HealthMonitorOptions {
  logger?: Pick<Console, "debug" | "info" | "warn" | "error">;
  safeMode?: SafeModeController;
  panicStop?: PanicStopController;
  onSnapshot?: (snapshot: HealthSnapshot) => void;
}

export class HealthMonitor {
  private readonly checks: HealthCheckDefinition[] = [];
  private timer?: NodeJS.Timeout;
  private latest?: HealthSnapshot;
  private degradedStreak = 0;
  private healthyStreak = 0;
  private running = false;

  constructor(
    private readonly config: HealthMonitoringConfig,
    private readonly options: HealthMonitorOptions = {}
  ) {}

  registerCheck(def: HealthCheckDefinition): void {
    this.checks.push(def);
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.runChecks();
    this.timer = setInterval(() => {
      void this.runChecks();
    }, this.config.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.running = false;
  }

  getLatestSnapshot(): HealthSnapshot | undefined {
    return this.latest;
  }

  private async runChecks(): Promise<void> {
    const statuses: HealthStatus[] = [];
    for (const def of this.checks) {
      try {
        const status = await def.fn();
        statuses.push({
          ...status,
          component: status.component ?? def.name,
          checkedAt: status.checkedAt ?? Date.now()
        });
      } catch (error) {
        statuses.push({
          component: def.name,
          state: "failed",
          checkedAt: Date.now(),
          details: error instanceof Error ? error.message : "Unknown error",
          consecutiveFailures: 1
        });
      }
    }
    const overall = computeOverallHealth(statuses);
    const snapshot: HealthSnapshot = {
      id: randomUUID(),
      overall,
      statuses,
      safeMode: this.options.safeMode?.getState() ?? { active: false },
      panicStop: this.options.panicStop?.getReason(),
      issuedAt: Date.now()
    };
    this.latest = snapshot;
    this.handleSnapshot(snapshot);
    this.options.onSnapshot?.(snapshot);
  }

  private handleSnapshot(snapshot: HealthSnapshot): void {
    if (!this.options.safeMode || !this.config.safeMode.enabled) {
      return;
    }
    if (snapshot.overall === "healthy") {
      this.healthyStreak += 1;
      this.degradedStreak = 0;
      if (
        this.options.safeMode.isActive() &&
        this.config.safeMode.autoExitSeconds &&
        this.healthyStreak >= 2
      ) {
        this.options.safeMode.exit();
      }
    } else {
      this.degradedStreak += 1;
      this.healthyStreak = 0;
      if (!this.options.panicStop?.isActive()) {
        this.options.safeMode.enter(`health:${snapshot.overall}`);
      }
    }
  }
}
