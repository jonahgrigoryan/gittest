import type { LogLevel, StructuredLogEvent } from "@poker-bot/shared";

export interface LogSink {
  readonly name: string;
  level: LogLevel;
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
  flush?(): Promise<void> | void;
  publish(event: StructuredLogEvent): Promise<void>;
}

export interface SinkFactoryOptions {
  level: LogLevel;
  sessionId: string;
}
