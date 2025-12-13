import type { EvaluationRunMetadata } from "@poker-bot/shared";
import type {
  HandOutcome,
  HandRecord,
  SessionMetrics,
} from "@poker-bot/shared";

export type LoggingFormat = "json" | "acpc";

export type RedactionField =
  | "playerNames"
  | "ids"
  | "ipAddresses"
  | "reasoning";

export interface RedactionConfig {
  enabled: boolean;
  fields: RedactionField[];
}

export interface MetricsConfig {
  enabled: boolean;
  windowHands: number;
}

export interface HandHistoryLoggerOptions {
  sessionId: string;
  outputDir: string;
  sessionPrefix?: string;
  flushIntervalMs: number;
  maxFileSizeMb: number;
  retentionDays: number;
  formats: LoggingFormat[];
  redaction: RedactionConfig;
  metrics: MetricsConfig;
  logger?: Pick<Console, "debug" | "info" | "warn" | "error">;
  evaluation?: EvaluationRunMetadata;
}

export interface IHandHistoryLogger {
  append(record: HandRecord): Promise<void>;
  recordOutcome(handId: string, outcome: HandOutcome): Promise<void>;
  flush(): Promise<void>;
  getMetrics(): SessionMetrics | null;
  close(): Promise<void>;
}
