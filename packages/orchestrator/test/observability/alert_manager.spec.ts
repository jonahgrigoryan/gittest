import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AlertManager } from "../../src/observability/alertManager";
import {
  LogLevel,
  type MetricsSnapshot,
  type StructuredLogEvent,
} from "@poker-bot/shared";
import type { ObservabilityAlertsConfig } from "@poker-bot/shared";
import type { AlertConsumer } from "../../src/observability/service";

const createMockObservabilityService = (): AlertConsumer & {
  log: ReturnType<typeof vi.fn>;
} => {
  const handlers: {
    handleEvent: ReturnType<typeof vi.fn>;
    handleSnapshot: ReturnType<typeof vi.fn>;
  } = {
    handleEvent: vi.fn(),
    handleSnapshot: vi.fn(),
  };
  const log = vi.fn();
  return {
    ...handlers,
    log,
  };
};

const baseConfig: ObservabilityAlertsConfig = {
  enabled: true,
  cooldownMs: 1000,
  channels: [
    { id: "console", type: "console", enabled: true, level: LogLevel.WARN },
  ],
  triggers: {
    panicStop: { id: "panicStop", enabled: true, cooldownMs: 5000 },
    safeMode: { id: "safeMode", enabled: true, cooldownMs: 5000 },
    solverTimeouts: {
      id: "solverTimeouts",
      enabled: true,
      cooldownMs: 5000,
      threshold: 5,
      windowHands: 100,
    },
    agentCost: {
      id: "agentCost",
      enabled: true,
      cooldownMs: 5000,
      threshold: 10,
    },
    healthDegradedMs: {
      id: "healthDegradedMs",
      enabled: true,
      cooldownMs: 5000,
    },
  },
};

describe("AlertManager", () => {
  describe("Phase 11: AlertManager Coverage", () => {
    let mockService: ReturnType<typeof createMockObservabilityService>;
    let alertManager: AlertManager;

    beforeEach(() => {
      mockService = createMockObservabilityService();
      alertManager = new AlertManager(baseConfig, mockService as any);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("emits alert when panic_stop event is triggered", () => {
      const event: StructuredLogEvent = {
        sessionId: "test",
        component: "test",
        event: "panic_stop_triggered",
        level: LogLevel.CRITICAL,
        timestamp: Date.now(),
        payload: { reason: "test panic" },
      };
      alertManager.handleEvent(event);
      expect(mockService.log).toHaveBeenCalledWith(
        LogLevel.CRITICAL,
        "alert_dispatched",
        expect.objectContaining({ triggerId: "panicStop" }),
        "observability.alerts",
      );
    });

    it("emits alert when safe_mode event is triggered", () => {
      const event: StructuredLogEvent = {
        sessionId: "test",
        component: "test",
        event: "safe_mode_entered",
        level: LogLevel.WARN,
        timestamp: Date.now(),
        payload: { reason: "test safe mode" },
      };
      alertManager.handleEvent(event);
      expect(mockService.log).toHaveBeenCalledWith(
        LogLevel.WARN,
        "alert_dispatched",
        expect.objectContaining({ triggerId: "safeMode" }),
        "observability.alerts",
      );
    });

    it("skips disabled triggers", () => {
      const disabledConfig: ObservabilityAlertsConfig = {
        ...baseConfig,
        triggers: {
          ...baseConfig.triggers,
          panicStop: { ...baseConfig.triggers.panicStop!, enabled: false },
        },
      };
      alertManager = new AlertManager(disabledConfig, mockService as any);

      const event: StructuredLogEvent = {
        sessionId: "test",
        component: "test",
        event: "panic_stop_triggered",
        level: LogLevel.CRITICAL,
        timestamp: Date.now(),
        payload: {},
      };
      alertManager.handleEvent(event);
      expect(mockService.log).not.toHaveBeenCalled();
    });

    it("skips all alerts when alerts are disabled globally", () => {
      const disabledConfig: ObservabilityAlertsConfig = {
        ...baseConfig,
        enabled: false,
      };
      alertManager = new AlertManager(disabledConfig, mockService as any);

      const event: StructuredLogEvent = {
        sessionId: "test",
        component: "test",
        event: "panic_stop_triggered",
        level: LogLevel.CRITICAL,
        timestamp: Date.now(),
        payload: {},
      };
      alertManager.handleEvent(event);
      expect(mockService.log).not.toHaveBeenCalled();
    });

    it("handles config updates immediately", () => {
      const event: StructuredLogEvent = {
        sessionId: "test",
        component: "test",
        event: "panic_stop_triggered",
        level: LogLevel.CRITICAL,
        timestamp: Date.now(),
        payload: {},
      };
      alertManager.handleEvent(event);
      expect(mockService.log).toHaveBeenCalledTimes(1);

      const newConfig: ObservabilityAlertsConfig = {
        ...baseConfig,
        triggers: {
          ...baseConfig.triggers,
          panicStop: { ...baseConfig.triggers.panicStop!, enabled: false },
        },
      };
      alertManager.updateConfig(newConfig);

      alertManager.handleEvent(event);
      expect(mockService.log).toHaveBeenCalledTimes(1);
    });

    it("dispatches alert with correct log level", () => {
      const panicEvent: StructuredLogEvent = {
        sessionId: "test",
        component: "test",
        event: "panic_stop_triggered",
        level: LogLevel.CRITICAL,
        timestamp: Date.now(),
        payload: {},
      };
      alertManager.handleEvent(panicEvent);
      expect(mockService.log).toHaveBeenCalledWith(
        LogLevel.CRITICAL,
        "alert_dispatched",
        expect.anything(),
        "observability.alerts",
      );
    });
  });

  describe("Phase 11: Metrics Threshold Handling", () => {
    let mockService: ReturnType<typeof createMockObservabilityService>;
    let alertManager: AlertManager;

    beforeEach(() => {
      mockService = createMockObservabilityService();
      alertManager = new AlertManager(baseConfig, mockService as any);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("triggers agentCost alert when threshold is exceeded", () => {
      const snapshot: MetricsSnapshot = {
        sessionId: "test",
        computedAt: Date.now(),
        totals: {
          handsLogged: 100,
          handsPerHour: 50,
          solverTimeouts: 0,
          safeModeEntries: 0,
          panicStops: 0,
          fallbackRisk: 0,
          fallbackGtoOnly: 0,
          agentTokens: 1000,
          agentCostUsd: 15,
          executionSuccessRate: 1.0,
        },
        latency: {
          gto: { p50: 100, p95: 200, p99: 300 },
          agents: { p50: 50, p95: 100, p99: 150 },
          execution: { p50: 20, p95: 40, p99: 60 },
          total: { p50: 170, p95: 340, p99: 510 },
        },
        evAccuracy: {
          meanDelta: 0.01,
          p50Delta: 0.01,
          p95Delta: 0.02,
          p99Delta: 0.03,
        },
        decisionQuality: {
          divergenceMean: 5,
          solverTimeoutRate: 0.01,
          fallbackCounts: { risk: 0, gtoOnly: 0 },
        },
      };
      alertManager.handleSnapshot(snapshot);
      expect(mockService.log).toHaveBeenCalledWith(
        LogLevel.WARN,
        "alert_dispatched",
        expect.objectContaining({ triggerId: "agentCost" }),
        "observability.alerts",
      );
    });

    it("triggers solverTimeouts alert when threshold is exceeded", () => {
      const snapshot: MetricsSnapshot = {
        sessionId: "test",
        computedAt: Date.now(),
        totals: {
          handsLogged: 100,
          handsPerHour: 50,
          solverTimeouts: 10,
          safeModeEntries: 0,
          panicStops: 0,
          fallbackRisk: 0,
          fallbackGtoOnly: 0,
          agentTokens: 1000,
          agentCostUsd: 5,
          executionSuccessRate: 1.0,
        },
        latency: {
          gto: { p50: 100, p95: 200, p99: 300 },
          agents: { p50: 50, p95: 100, p99: 150 },
          execution: { p50: 20, p95: 40, p99: 60 },
          total: { p50: 170, p95: 340, p99: 510 },
        },
        evAccuracy: {
          meanDelta: 0.01,
          p50Delta: 0.01,
          p95Delta: 0.02,
          p99Delta: 0.03,
        },
        decisionQuality: {
          divergenceMean: 5,
          solverTimeoutRate: 0.01,
          fallbackCounts: { risk: 0, gtoOnly: 0 },
        },
      };
      alertManager.handleSnapshot(snapshot);
      expect(mockService.log).toHaveBeenCalledWith(
        LogLevel.WARN,
        "alert_dispatched",
        expect.objectContaining({ triggerId: "solverTimeouts" }),
        "observability.alerts",
      );
    });

    it("triggers safeMode alert when safe mode is active in snapshot", () => {
      const snapshot: MetricsSnapshot = {
        sessionId: "test",
        computedAt: Date.now(),
        totals: {
          handsLogged: 100,
          handsPerHour: 50,
          solverTimeouts: 0,
          safeModeEntries: 1,
          panicStops: 0,
          fallbackRisk: 0,
          fallbackGtoOnly: 0,
          agentTokens: 1000,
          agentCostUsd: 5,
          executionSuccessRate: 1.0,
        },
        latency: {
          gto: { p50: 100, p95: 200, p99: 300 },
          agents: { p50: 50, p95: 100, p99: 150 },
          execution: { p50: 20, p95: 40, p99: 60 },
          total: { p50: 170, p95: 340, p99: 510 },
        },
        evAccuracy: {
          meanDelta: 0.01,
          p50Delta: 0.01,
          p95Delta: 0.02,
          p99Delta: 0.03,
        },
        decisionQuality: {
          divergenceMean: 5,
          solverTimeoutRate: 0.01,
          fallbackCounts: { risk: 0, gtoOnly: 0 },
        },
        safeMode: { active: true },
      };
      alertManager.handleSnapshot(snapshot);
      expect(mockService.log).toHaveBeenCalledWith(
        LogLevel.WARN,
        "alert_dispatched",
        expect.objectContaining({ triggerId: "safeMode" }),
        "observability.alerts",
      );
    });

    it("triggers panicStop alert when panicStops > 0 in snapshot", () => {
      const snapshot: MetricsSnapshot = {
        sessionId: "test",
        computedAt: Date.now(),
        totals: {
          handsLogged: 100,
          handsPerHour: 50,
          solverTimeouts: 0,
          safeModeEntries: 0,
          panicStops: 1,
          fallbackRisk: 0,
          fallbackGtoOnly: 0,
          agentTokens: 1000,
          agentCostUsd: 5,
          executionSuccessRate: 1.0,
        },
        latency: {
          gto: { p50: 100, p95: 200, p99: 300 },
          agents: { p50: 50, p95: 100, p99: 150 },
          execution: { p50: 20, p95: 40, p99: 60 },
          total: { p50: 170, p95: 340, p99: 510 },
        },
        evAccuracy: {
          meanDelta: 0.01,
          p50Delta: 0.01,
          p95Delta: 0.02,
          p99Delta: 0.03,
        },
        decisionQuality: {
          divergenceMean: 5,
          solverTimeoutRate: 0.01,
          fallbackCounts: { risk: 0, gtoOnly: 0 },
        },
      };
      alertManager.handleSnapshot(snapshot);
      expect(mockService.log).toHaveBeenCalledWith(
        LogLevel.CRITICAL,
        "alert_dispatched",
        expect.objectContaining({ triggerId: "panicStop" }),
        "observability.alerts",
      );
    });
  });

  describe("Phase 11: Multi-Trigger Scenarios", () => {
    it("handles multiple alert sources firing", () => {
      const mockService = createMockObservabilityService();
      const alertManager = new AlertManager(baseConfig, mockService as any);

      const panicEvent: StructuredLogEvent = {
        sessionId: "test",
        component: "test",
        event: "panic_stop_triggered",
        level: LogLevel.CRITICAL,
        timestamp: Date.now(),
        payload: {},
      };
      const safeModeEvent: StructuredLogEvent = {
        sessionId: "test",
        component: "test",
        event: "safe_mode_entered",
        level: LogLevel.WARN,
        timestamp: Date.now(),
        payload: {},
      };

      alertManager.handleEvent(panicEvent);
      alertManager.handleEvent(safeModeEvent);

      expect(mockService.log).toHaveBeenCalledTimes(2);
      const dispatchedCalls = mockService.log.mock.calls.filter(
        (call) => call[1] === "alert_dispatched",
      );
      expect(dispatchedCalls).toHaveLength(2);
    });
  });
});
