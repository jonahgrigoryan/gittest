import { describe, it, expect, afterEach } from "vitest";
import { HealthMonitor } from "../../src/health/monitor";
import { SafeModeController } from "../../src/health/safeModeController";
import { PanicStopController } from "../../src/health/panicStopController";
import type { HealthMonitoringConfig } from "@poker-bot/shared/src/config/types";

const baseConfig: HealthMonitoringConfig = {
  intervalMs: 50,
  degradedThresholds: {
    visionConfidenceMin: 0.99,
    solverLatencyMs: 800,
    executorFailureRate: 0.2
  },
  safeMode: {
    enabled: true,
    autoExitSeconds: 1
  },
  panicStop: {
    visionConfidenceFrames: 3,
    minConfidence: 0.99,
    riskGuardAutoTrip: true
  },
  dashboard: {
    enabled: false,
    port: 7777
  }
};

describe("HealthMonitor", () => {
  let monitor: HealthMonitor | undefined;

  afterEach(() => {
    monitor?.stop();
    monitor = undefined;
  });

  it("enters safe mode when checks report degraded state", async () => {
    const safeMode = new SafeModeController();
    const panic = new PanicStopController(safeMode);
    monitor = new HealthMonitor(baseConfig, { safeMode, panicStop: panic });
    monitor.registerCheck({
      name: "vision",
      fn: async () => ({
        component: "vision",
        state: "degraded",
        checkedAt: Date.now(),
        consecutiveFailures: 1
      })
    });
    monitor.start();
    await new Promise(resolve => setTimeout(resolve, baseConfig.intervalMs * 2));
    expect(safeMode.isActive()).toBe(true);
  });
});
