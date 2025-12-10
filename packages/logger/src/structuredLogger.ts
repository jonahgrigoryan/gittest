import {
  LogLevel,
  createStructuredEvent,
  shouldLog,
  type StructuredLogEvent
} from "@poker-bot/shared";
import type { LogSink } from "./sinks/types";

export interface StructuredLoggerOptions {
  sessionId: string;
  baseComponent: string;
  level: LogLevel;
  sinks: LogSink[];
  queueSize?: number;
  defaultContext?: Record<string, unknown>;
  onDrop?: (event: StructuredLogEvent) => void;
}

interface LogOptions {
  component?: string;
  dedupParts?: Array<string | number | undefined | null>;
  tags?: string[];
}

export class StructuredLogger {
  private readonly queue: StructuredLogEvent[] = [];
  private draining = false;
  private stopped = false;
  private readonly queueSize: number;
  private readonly defaultContext: Record<string, unknown>;

  constructor(private readonly options: StructuredLoggerOptions) {
    this.queueSize = Math.max(100, options.queueSize ?? 1000);
    this.defaultContext = options.defaultContext ?? {};
  }

  async start() {
    await Promise.all(
      this.options.sinks.map(async sink => {
        if (sink.start) {
          await sink.start();
        }
      })
    );
  }

  async stop() {
    this.stopped = true;
    await this.flushOutstanding();
    await Promise.all(
      this.options.sinks.map(async sink => {
        if (sink.stop) {
          await sink.stop();
        }
      })
    );
  }

  async flushOutstanding() {
    while (this.queue.length > 0) {
      await this.drainQueue();
    }
    await Promise.all(
      this.options.sinks.map(async sink => {
        if (sink.flush) {
          await sink.flush();
        }
      })
    );
  }

  log(
    level: LogLevel,
    event: string,
    payload?: Record<string, unknown>,
    logOptions?: LogOptions
  ) {
    if (this.stopped) {
      return;
    }
    if (!shouldLog(level, this.options.level)) {
      return;
    }
    if (this.queue.length >= this.queueSize) {
      const dropped = createStructuredEvent({
        sessionId: this.options.sessionId,
        component: logOptions?.component ?? this.options.baseComponent,
        level,
        event,
        payload
      });
      this.options.onDrop?.(dropped);
      return;
    }
    const structured = createStructuredEvent({
      sessionId: this.options.sessionId,
      component: logOptions?.component ?? this.options.baseComponent,
      level,
      event,
      payload: { ...this.defaultContext, ...payload },
      dedupParts: logOptions?.dedupParts,
      tags: logOptions?.tags
    });
    this.queue.push(structured);
    void this.drainQueue();
  }

  child(component: string, defaultContext?: Record<string, unknown>): Pick<StructuredLogger, "log" | "child"> {
    const mergedContext = {
      ...this.defaultContext,
      ...(defaultContext ?? {})
    };
    return {
      log: (level, event, payload, options) => {
        this.log(
          level,
          event,
          { ...mergedContext, ...payload },
          { ...options, component }
        );
      },
      child: (nextComponent: string, childContext?: Record<string, unknown>) => {
        return this.child(nextComponent, {
          ...mergedContext,
          ...(childContext ?? {})
        });
      }
    };
  }

  private async drainQueue() {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      while (this.queue.length) {
        const next = this.queue.shift()!;
        await Promise.allSettled(
          this.options.sinks.map(async sink => {
            try {
              await sink.publish(next);
            } catch (error) {
              if (sink.name === "console") {
                // console sink already logs via console
                return;
              }
              console.warn(
                `[structured-logger] sink ${sink.name} failed`,
                error
              );
            }
          })
        );
      }
    } finally {
      this.draining = false;
    }
  }
}
