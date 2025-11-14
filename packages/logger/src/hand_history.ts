import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";
import type { HandOutcome, HandRecord, SessionMetrics } from "@poker-bot/shared";
import type {
  HandHistoryLoggerOptions,
  IHandHistoryLogger,
  LoggingFormat
} from "./types";
import { writeExport } from "./exporters";
import { redactHandRecord } from "./redaction";
import { MetricsCollector } from "./metrics";
import { enforceRetention } from "./retention";

const HOLD_TIMEOUT_MS = 1000;
const BATCH_SIZE = 10;

interface PendingHand {
  record: HandRecord;
  timeout: NodeJS.Timeout;
}

export class HandHistoryLogger implements IHandHistoryLogger {
  private readonly pendingHands = new Map<string, PendingHand>();
  private readonly pendingOutcomes = new Map<string, HandOutcome>();
  private readonly queue: HandRecord[] = [];
  private readonly exporterTasks = new Set<Promise<void>>();
  private readonly metrics: MetricsCollector;
  private readonly maxBytes: number;
  private writeStream?: WriteStream;
  private rotationPromise: Promise<void> | null = null;
  private flushTimer?: NodeJS.Timeout;
  private flushPromise: Promise<void> | null = null;
  private currentFileSize = 0;
  private readonly sessionLabel: string;
  private readonly sessionDir: string;
  private readonly exportDir: string;
  private readonly beforeExitHandler = () => {
    void this.flush();
  };

  constructor(private readonly options: HandHistoryLoggerOptions) {
    const prefix = options.sessionPrefix ?? "HH";
    this.sessionLabel = `${prefix}_${options.sessionId}`;
    this.sessionDir = join(options.outputDir, this.sessionLabel);
    this.exportDir = join(options.outputDir, this.sessionLabel);
    this.metrics = new MetricsCollector(options.metrics);
    this.maxBytes = Math.max(1, options.maxFileSizeMb) * 1024 * 1024;
  }

  async start(): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });
    await enforceRetention(this.options.outputDir, this.options.retentionDays, {
      sessionPrefix: this.options.sessionPrefix,
      activeSessionId: this.options.sessionId
    });
    await this.rotateLog();
    this.flushTimer = setInterval(() => {
      if (this.queue.length > 0) {
        void this.flush();
      } else {
        this.flushStaleHands();
      }
    }, this.options.flushIntervalMs);
    process.on("beforeExit", this.beforeExitHandler);
  }

  async append(record: HandRecord): Promise<void> {
    const { record: redacted } = redactHandRecord(record, this.options.redaction);
    const pendingOutcome = this.pendingOutcomes.get(redacted.handId);
    if (pendingOutcome) {
      redacted.outcome = pendingOutcome;
      this.pendingOutcomes.delete(redacted.handId);
    }

    const timeout = setTimeout(() => this.finalize(redacted.handId), HOLD_TIMEOUT_MS);
    this.pendingHands.set(redacted.handId, { record: redacted, timeout });

    if (redacted.outcome) {
      this.finalize(redacted.handId);
    }
  }

  async recordOutcome(handId: string, outcome: HandOutcome): Promise<void> {
    this.pendingOutcomes.set(handId, outcome);
    const pending = this.pendingHands.get(handId);
    if (pending) {
      pending.record.outcome = outcome;
      this.finalize(handId);
    }
  }

  async flush(): Promise<void> {
    if (this.flushPromise) {
      await this.flushPromise;
      return;
    }
    this.flushPromise = this.flushInternal().finally(() => {
      this.flushPromise = null;
    });
    await this.flushPromise;
  }

  getMetrics(): SessionMetrics | null {
    if (!this.options.metrics.enabled) {
      return null;
    }
    return this.metrics.snapshot(this.options.sessionId);
  }

  async close(): Promise<void> {
    for (const [, pending] of this.pendingHands) {
      clearTimeout(pending.timeout);
      this.queue.push(pending.record);
    }
    this.pendingHands.clear();
    await this.flush();

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }

    process.off("beforeExit", this.beforeExitHandler);

    if (this.writeStream) {
      this.writeStream.end();
      await once(this.writeStream, "close");
      this.writeStream = undefined;
    }

    await Promise.all(this.exporterTasks);
  }

  private finalize(handId: string) {
    const pending = this.pendingHands.get(handId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingHands.delete(handId);
    this.queue.push(pending.record);
    if (this.queue.length >= BATCH_SIZE) {
      void this.flush();
    }
  }

  private flushStaleHands() {
    const now = Date.now();
    for (const [handId, pending] of this.pendingHands) {
      if (now - pending.record.createdAt > HOLD_TIMEOUT_MS) {
        this.finalize(handId);
      }
    }
  }

  private async flushInternal(): Promise<void> {
    if (this.queue.length === 0) {
      return;
    }
    const records = this.queue.splice(0);
    for (const record of records) {
      await this.writeRecord(record);
      this.metrics.record(record);
      this.scheduleExport(record);
    }
  }

  private scheduleExport(record: HandRecord) {
    for (const format of this.options.formats as LoggingFormat[]) {
      const task = writeExport(record, format, this.exportDir).catch(error => {
        this.options.logger?.warn?.("HandHistoryLogger exporter failed", {
          handId: record.handId,
          format,
          error: error instanceof Error ? error.message : error
        });
      });
      this.exporterTasks.add(task);
      task.finally(() => this.exporterTasks.delete(task));
    }
  }

  private async writeRecord(record: HandRecord): Promise<void> {
    if (!this.writeStream) {
      throw new Error("HandHistoryLogger not started");
    }
    const payload = JSON.stringify(record);
    let attempt = 0;
    const writeWithRetry = async (): Promise<void> => {
      try {
        await new Promise<void>((resolve, reject) => {
          this.writeStream!.write(`${payload}\n`, err => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      } catch (error) {
        attempt += 1;
        if (attempt >= 3) {
          throw error;
        }
        const delay = 2 ** attempt * 10;
        await new Promise(resolve => setTimeout(resolve, delay));
        await writeWithRetry();
      }
    };
    await writeWithRetry();
    this.currentFileSize += Buffer.byteLength(payload) + 1;
    if (this.currentFileSize >= this.maxBytes) {
      await this.rotateLog();
    }
  }

  private async rotateLog(): Promise<void> {
    if (this.rotationPromise) {
      await this.rotationPromise;
      return;
    }
    this.rotationPromise = this.rotateLogInternal().finally(() => {
      this.rotationPromise = null;
    });
    await this.rotationPromise;
  }

  private async rotateLogInternal(): Promise<void> {
    if (this.writeStream) {
      this.writeStream.end();
      await once(this.writeStream, "close");
    }
    await mkdir(this.sessionDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = join(this.sessionDir, `${this.sessionLabel}_${timestamp}.jsonl`);
    this.writeStream = createWriteStream(filePath, { flags: "a" });
    this.currentFileSize = 0;
  }
}

export async function createHandHistoryLogger(
  options: HandHistoryLoggerOptions
): Promise<HandHistoryLogger> {
  const logger = new HandHistoryLogger(options);
  await logger.start();
  return logger;
}
