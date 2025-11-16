import { createHash } from "node:crypto";

export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
  CRITICAL = "critical"
}

const levelOrder: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 10,
  [LogLevel.INFO]: 20,
  [LogLevel.WARN]: 30,
  [LogLevel.ERROR]: 40,
  [LogLevel.CRITICAL]: 50
};

export function shouldLog(target: LogLevel, minimum: LogLevel): boolean {
  return levelOrder[target] >= levelOrder[minimum];
}

export interface StructuredLogEvent<TPayload = Record<string, unknown>> {
  sessionId: string;
  component: string;
  event: string;
  level: LogLevel;
  timestamp: number;
  payload?: TPayload;
  dedupKey?: string;
  tags?: string[];
}

export type AuditEventPayload = Record<string, unknown>;

export interface MetricsLatencyQuantiles {
  p50: number;
  p95: number;
  p99: number;
}

export interface MetricsSnapshot {
  sessionId: string;
  computedAt: number;
  totals: {
    handsLogged: number;
    handsPerHour: number;
    solverTimeouts: number;
    safeModeEntries: number;
    panicStops: number;
    fallbackRisk: number;
    fallbackGtoOnly: number;
    agentTokens: number;
    agentCostUsd: number;
    executionSuccessRate: number;
  };
  latency: {
    gto: MetricsLatencyQuantiles;
    agents: MetricsLatencyQuantiles;
    execution: MetricsLatencyQuantiles;
    total: MetricsLatencyQuantiles;
  };
  evAccuracy: {
    meanDelta: number;
    p50Delta: number;
    p95Delta: number;
    p99Delta: number;
  };
  decisionQuality: {
    divergenceMean: number;
    solverTimeoutRate: number;
    fallbackCounts: {
      risk: number;
      gtoOnly: number;
    };
  };
  safeMode?: {
    active: boolean;
    since?: number;
  };
}

export interface AlertTriggerState {
  lastTriggeredAt?: number;
  suppressed?: boolean;
}

export interface AlertTriggerConfig {
  id: string;
  enabled: boolean;
  cooldownMs: number;
  threshold?: number;
  windowHands?: number;
  description?: string;
}

export interface AlertChannelConfig {
  id: string;
  type: "console" | "file" | "webhook";
  enabled: boolean;
  level?: LogLevel;
  path?: string;
  url?: string;
  headers?: Record<string, string>;
  batchSize?: number;
}

export function makeDedupKey(parts: Array<string | number | undefined | null>): string {
  const normalized = parts
    .filter(part => part !== undefined && part !== null)
    .map(part => String(part))
    .join("|");
  const hash = createHash("sha1");
  hash.update(normalized);
  return hash.digest("hex");
}

interface StructuredEventOptions<TPayload> {
  sessionId: string;
  component: string;
  level: LogLevel;
  event: string;
  payload?: TPayload;
  dedupParts?: Array<string | number | undefined | null>;
  timestamp?: number;
  tags?: string[];
}

export function createStructuredEvent<TPayload = Record<string, unknown>>(
  options: StructuredEventOptions<TPayload>
): StructuredLogEvent<TPayload> {
  return {
    sessionId: options.sessionId,
    component: options.component,
    level: options.level,
    event: options.event,
    timestamp: options.timestamp ?? Date.now(),
    payload: options.payload,
    tags: options.tags,
    dedupKey: options.dedupParts ? makeDedupKey(options.dedupParts) : undefined
  };
}
