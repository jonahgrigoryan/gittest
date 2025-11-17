import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { LogLevel, shouldLog, type StructuredLogEvent } from "@poker-bot/shared";
import type { LogSink } from "./types";

interface FileSinkOptions {
  sessionId: string;
  level: LogLevel;
  outputDir: string;
  maxFileSizeMb?: number;
  maxFiles?: number;
  logger?: Pick<Console, "warn" | "error">;
}

export function createFileSink(options: FileSinkOptions): LogSink {
  const sink = new RotatingFileSink(options);
  return {
    name: "file",
    level: options.level,
    start: () => sink.start(),
    stop: () => sink.stop(),
    flush: () => sink.flush(),
    publish: event => sink.publish(event)
  };
}

class RotatingFileSink {
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private stream: WriteStream | null = null;
  private currentFile?: string;
  private bytesWritten = 0;
  private queue: StructuredLogEvent[] = [];
  private draining = false;
  private started = false;

  constructor(private readonly options: FileSinkOptions) {
    this.maxBytes = Math.max(0.001, options.maxFileSizeMb ?? 25) * 1024 * 1024;
    this.maxFiles = Math.max(1, options.maxFiles ?? 10);
  }

  async start() {
    if (this.started) {
      return;
    }
    await mkdir(this.options.outputDir, { recursive: true });
    await this.rotate();
    this.started = true;
  }

  async stop() {
    if (this.stream) {
      await new Promise<void>(resolve => {
        this.stream!.end("", () => resolve());
      });
      this.stream = null;
    }
    this.started = false;
  }

  async flush() {
    if (!this.stream) {
      return;
    }
    await new Promise<void>(resolve => {
      if (this.stream!.writableNeedDrain) {
        this.stream!.once("drain", () => resolve());
      } else {
        resolve();
      }
    });
  }

  async publish(event: StructuredLogEvent) {
    if (!shouldLog(event.level, this.options.level)) {
      return;
    }
    this.queue.push(event);
    if (!this.draining) {
      this.draining = true;
      try {
        while (this.queue.length) {
          const next = this.queue.shift()!;
          await this.write(next);
        }
      } finally {
        this.draining = false;
      }
    }
  }

  private async write(event: StructuredLogEvent) {
    if (!this.started) {
      await this.start();
    }
    const payload = JSON.stringify(event) + "\n";
    if (this.bytesWritten + Buffer.byteLength(payload) > this.maxBytes) {
      await this.rotate();
    }
    await new Promise<void>((resolve, reject) => {
      this.stream!.write(payload, error => {
        if (error) {
          this.options.logger?.error?.("File sink write failed", error);
          reject(error);
          return;
        }
        this.bytesWritten += Buffer.byteLength(payload);
        resolve();
      });
    });
  }

  private async rotate() {
    if (this.stream) {
      await new Promise<void>(resolve => this.stream!.end(resolve));
    }
    const fileName = `${this.options.sessionId}-${Date.now()}.jsonl`;
    const nextPath = path.join(this.options.outputDir, fileName);
    this.stream = createWriteStream(nextPath, { flags: "a" });
    this.currentFile = nextPath;
    this.bytesWritten = 0;
    await this.pruneOldFiles();
  }

  private async pruneOldFiles() {
    try {
      const entries = await readdir(this.options.outputDir);
      const files = await Promise.all(
        entries
          .filter(entry => entry.endsWith(".jsonl"))
          .map(async entry => {
            const fullPath = path.join(this.options.outputDir, entry);
            const info = await stat(fullPath);
            return { fullPath, mtime: info.mtimeMs };
          })
      );
      if (files.length <= this.maxFiles) {
        return;
      }
      const sorted = files.sort((a, b) => b.mtime - a.mtime);
      const toDelete = sorted.slice(this.maxFiles);
      await Promise.allSettled(
        toDelete.map(file => unlink(file.fullPath).catch(error => {
          this.options.logger?.warn?.("Failed to remove old log file", error);
        }))
      );
    } catch (error) {
      this.options.logger?.warn?.("Failed to prune log files", error as Error);
    }
  }
}
