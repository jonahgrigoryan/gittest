import { setTimeout as delay } from "node:timers/promises";
import { LogLevel, shouldLog, type StructuredLogEvent } from "@poker-bot/shared";
import type { LogSink } from "./types";

interface WebhookSinkOptions {
  level: LogLevel;
  url: string;
  headers?: Record<string, string>;
  batchSize?: number;
  retry?: {
    attempts: number;
    backoffMs: number;
  };
  logger?: Pick<Console, "warn" | "error">;
}

export function createWebhookSink(options: WebhookSinkOptions): LogSink {
  const sink = new WebhookSink(options);
  return {
    name: "webhook",
    level: options.level,
    start: () => sink.start(),
    stop: () => sink.stop(),
    publish: event => sink.publish(event)
  };
}

class WebhookSink {
  private queue: StructuredLogEvent[] = [];
  private draining = false;
  private stopped = false;
  private readonly batchSize: number;
  private readonly retryAttempts: number;
  private readonly retryBackoff: number;
  private circuitOpenUntil = 0;

  constructor(private readonly options: WebhookSinkOptions) {
    this.batchSize = Math.max(1, options.batchSize ?? 10);
    this.retryAttempts = Math.max(1, options.retry?.attempts ?? 3);
    this.retryBackoff = Math.max(100, options.retry?.backoffMs ?? 1000);
  }

  async start() {
    this.stopped = false;
  }

  async stop() {
    this.stopped = true;
  }

  async publish(event: StructuredLogEvent) {
    if (!shouldLog(event.level, this.options.level)) {
      return;
    }
    if (this.stopped) {
      return;
    }

    if (Date.now() < this.circuitOpenUntil) {
      this.options.logger?.warn?.("Webhook sink circuit open, dropping event");
      return;
    }

    this.queue.push(event);
    if (!this.draining) {
      this.draining = true;
      try {
        while (this.queue.length && !this.stopped) {
          const batch = this.queue.splice(0, this.batchSize);
          await this.sendBatch(batch);
        }
      } finally {
        this.draining = false;
      }
    }
  }

  private async sendBatch(batch: StructuredLogEvent[]) {
    const body = JSON.stringify({ events: batch });
    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      try {
        const response = await fetch(this.options.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...this.options.headers
          },
          body
        });
        if (!response.ok) {
          throw new Error(`Webhook responded with status ${response.status}`);
        }
        return;
      } catch (error) {
        this.options.logger?.warn?.(
          `Webhook sink attempt ${attempt} failed`,
          error as Error
        );
        if (attempt === this.retryAttempts) {
          this.circuitOpenUntil = Date.now() + this.retryBackoff * 5;
          return;
        }
        await delay(this.retryBackoff * attempt);
      }
    }
  }
}
