import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { MetricsSnapshot, ObservabilityConfig } from "@poker-bot/shared";
import { LogLevel } from "@poker-bot/shared";
import { ObservabilityService } from "../../src/observability/service";

const loggerMocks = vi.hoisted(() => {
  const structuredLoggerInstances: Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    log: ReturnType<typeof vi.fn>;
    options: unknown;
  }> = [];
  const reporterInstances: Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    flush: ReturnType<typeof vi.fn>;
    recordDecision: ReturnType<typeof vi.fn>;
    recordAgentTelemetry: ReturnType<typeof vi.fn>;
    recordSafeMode: ReturnType<typeof vi.fn>;
    recordPanicStop: ReturnType<typeof vi.fn>;
    recordSolverTimeout: ReturnType<typeof vi.fn>;
    recordExecutionResult: ReturnType<typeof vi.fn>;
    options: unknown;
  }> = [];

  const createConsoleSink = vi.fn(() => ({
    name: "console",
    publish: vi.fn(),
  }));
  const createFileSink = vi.fn(() => ({
    name: "file",
    publish: vi.fn(),
  }));
  const createWebhookSink = vi.fn(() => ({
    name: "webhook",
    publish: vi.fn(),
  }));

  class StructuredLoggerMock {
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    log = vi.fn();
    options: unknown;

    constructor(options: unknown) {
      this.options = options;
      structuredLoggerInstances.push(this);
    }
  }

  class ObservabilityReporterMock {
    start = vi.fn();
    stop = vi.fn();
    flush = vi.fn().mockResolvedValue(null);
    recordDecision = vi.fn();
    recordAgentTelemetry = vi.fn();
    recordSafeMode = vi.fn();
    recordPanicStop = vi.fn();
    recordSolverTimeout = vi.fn();
    recordExecutionResult = vi.fn();
    options: unknown;

    constructor(options: unknown) {
      this.options = options;
      reporterInstances.push(this);
    }
  }

  return {
    structuredLoggerInstances,
    reporterInstances,
    createConsoleSink,
    createFileSink,
    createWebhookSink,
    StructuredLoggerMock,
    ObservabilityReporterMock,
  };
});

vi.mock("@poker-bot/logger", () => ({
  StructuredLogger: loggerMocks.StructuredLoggerMock,
  ObservabilityReporter: loggerMocks.ObservabilityReporterMock,
  createConsoleSink: loggerMocks.createConsoleSink,
  createFileSink: loggerMocks.createFileSink,
  createWebhookSink: loggerMocks.createWebhookSink,
}));

const baseConfig: ObservabilityConfig = {
  logs: {
    level: LogLevel.INFO,
    sinks: {
      console: { enabled: true },
    },
  },
  metrics: {
    flushIntervalMs: 1000,
    maxRecentHands: 10,
    emitHandSummaries: false,
  },
  alerts: {
    enabled: true,
    cooldownMs: 1000,
    channels: [],
    triggers: {},
  },
};

const createSnapshot = (): MetricsSnapshot => ({
  sessionId: "session-1",
  computedAt: 1234,
  totals: {
    handsLogged: 0,
    handsPerHour: 0,
    solverTimeouts: 0,
    safeModeEntries: 0,
    panicStops: 0,
    fallbackRisk: 0,
    fallbackGtoOnly: 0,
    agentTokens: 0,
    agentCostUsd: 0,
    executionSuccessRate: 1,
  },
  latency: {
    gto: { p50: 0, p95: 0, p99: 0 },
    agents: { p50: 0, p95: 0, p99: 0 },
    execution: { p50: 0, p95: 0, p99: 0 },
    total: { p50: 0, p95: 0, p99: 0 },
  },
  evAccuracy: {
    meanDelta: 0,
    p50Delta: 0,
    p95Delta: 0,
    p99Delta: 0,
  },
  decisionQuality: {
    divergenceMean: 0,
    solverTimeoutRate: 0,
    fallbackCounts: { risk: 0, gtoOnly: 0 },
  },
});

const createService = (config: ObservabilityConfig) =>
  new ObservabilityService({
    sessionId: "session-1",
    sessionDir: "/tmp/session",
    config,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  });

describe("ObservabilityService", () => {
  beforeEach(() => {
    loggerMocks.structuredLoggerInstances.length = 0;
    loggerMocks.reporterInstances.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies config and starts reporter/logger", async () => {
    const service = createService(baseConfig);
    await service.applyConfig(baseConfig);

    expect(loggerMocks.createConsoleSink).toHaveBeenCalledWith({
      level: baseConfig.logs.level,
    });
    expect(loggerMocks.structuredLoggerInstances).toHaveLength(1);
    expect(loggerMocks.reporterInstances).toHaveLength(1);
    expect(loggerMocks.structuredLoggerInstances[0].start).toHaveBeenCalledTimes(1);
    expect(loggerMocks.reporterInstances[0].start).toHaveBeenCalledTimes(1);
  });

  it("disposes previous reporter/logger on config update", async () => {
    const service = createService(baseConfig);
    await service.applyConfig(baseConfig);

    const firstLogger = loggerMocks.structuredLoggerInstances[0];
    const firstReporter = loggerMocks.reporterInstances[0];

    const updatedConfig: ObservabilityConfig = {
      ...baseConfig,
      logs: {
        ...baseConfig.logs,
        level: LogLevel.WARN,
      },
    };

    await service.applyConfig(updatedConfig);

    expect(firstLogger.stop).toHaveBeenCalledTimes(1);
    expect(firstReporter.stop).toHaveBeenCalledTimes(1);
    expect(loggerMocks.structuredLoggerInstances).toHaveLength(2);
    expect(loggerMocks.reporterInstances).toHaveLength(2);
  });

  it("forwards log events to structured logger and alert consumer", async () => {
    const service = createService(baseConfig);
    await service.applyConfig(baseConfig);
    const consumer = { handleEvent: vi.fn(), handleSnapshot: vi.fn() };
    service.registerAlertConsumer(consumer);

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1234);
    service.log(LogLevel.INFO, "test_event", { ok: true }, "unit.test");

    expect(loggerMocks.structuredLoggerInstances[0].log).toHaveBeenCalledWith(
      LogLevel.INFO,
      "test_event",
      { ok: true },
      { component: "unit.test" },
    );
    expect(consumer.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        component: "unit.test",
        event: "test_event",
        level: LogLevel.INFO,
        timestamp: 1234,
        payload: { ok: true },
      }),
    );
    nowSpy.mockRestore();
  });

  it("flush returns snapshot and notifies alert consumer", async () => {
    const service = createService(baseConfig);
    await service.applyConfig(baseConfig);
    const consumer = { handleEvent: vi.fn(), handleSnapshot: vi.fn() };
    service.registerAlertConsumer(consumer);

    const snapshot = createSnapshot();
    loggerMocks.reporterInstances[0].flush.mockResolvedValueOnce(snapshot);

    const result = await service.flush();

    expect(result).toEqual(snapshot);
    expect(consumer.handleSnapshot).toHaveBeenCalledWith(snapshot);
  });

  it("flush is idempotent", async () => {
    const service = createService(baseConfig);
    await service.applyConfig(baseConfig);
    const snapshot = createSnapshot();
    loggerMocks.reporterInstances[0].flush.mockResolvedValue(snapshot);

    await service.flush();
    await service.flush();

    expect(loggerMocks.reporterInstances[0].flush).toHaveBeenCalledTimes(2);
  });

  it("flush after events returns snapshot and emits alert consumer snapshot", async () => {
    const service = createService(baseConfig);
    await service.applyConfig(baseConfig);
    const consumer = { handleEvent: vi.fn(), handleSnapshot: vi.fn() };
    service.registerAlertConsumer(consumer);

    service.recordExecutionResult(true);
    expect(
      loggerMocks.reporterInstances[0].recordExecutionResult,
    ).toHaveBeenCalledWith(true);

    const snapshot = createSnapshot();
    loggerMocks.reporterInstances[0].flush.mockResolvedValueOnce(snapshot);

    const result = await service.flush();

    expect(result).toEqual(snapshot);
    expect(consumer.handleSnapshot).toHaveBeenCalledWith(snapshot);
  });

  it("handles configs with no sinks without throwing", async () => {
    const noSinkConfig: ObservabilityConfig = {
      ...baseConfig,
      logs: {
        ...baseConfig.logs,
        sinks: {},
      },
    };
    const service = createService(noSinkConfig);

    await expect(service.applyConfig(noSinkConfig)).resolves.toBeUndefined();
    expect(loggerMocks.createConsoleSink).not.toHaveBeenCalled();
  });
});
