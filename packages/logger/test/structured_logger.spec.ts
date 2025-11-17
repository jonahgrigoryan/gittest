import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  LogLevel,
  type StructuredLogEvent
} from "@poker-bot/shared";
import { StructuredLogger } from "../src/structuredLogger";
import type { LogSink } from "../src/sinks/types";
import { createFileSink } from "../src/sinks/fileSink";
import { createWebhookSink } from "../src/sinks/webhookSink";

describe("StructuredLogger", () => {
  it("filters logs below minimum level and merges child context", async () => {
    const received: StructuredLogEvent[] = [];
    const sink: LogSink = {
      name: "memory",
      level: LogLevel.DEBUG,
      publish: async event => {
        received.push(event);
      }
    };
    const logger = new StructuredLogger({
      sessionId: "session-1",
      baseComponent: "root",
      level: LogLevel.INFO,
      sinks: [sink]
    });

    logger.log(LogLevel.DEBUG, "ignore");
    logger.log(LogLevel.ERROR, "root-event", { root: true });
    const child = logger.child("child", { childCtx: true });
    child.log(LogLevel.INFO, "child-event", { foo: "bar" });

    await logger.flushOutstanding();

    expect(received).toHaveLength(2);
    expect(received[0].event).toBe("root-event");
    expect(received[1].component).toBe("child");
    expect(received[1].payload?.childCtx).toBe(true);
    expect(received[1].payload?.foo).toBe("bar");
  });
});

describe("file sink", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "logger-test-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rotates files when exceeding max size", async () => {
    const sink = createFileSink({
      sessionId: "sessionA",
      level: LogLevel.DEBUG,
      outputDir: tempDir,
      maxFileSizeMb: 0.001, // force rotation quickly
      maxFiles: 5
    });
    await sink.start?.();

    for (let i = 0; i < 5; i += 1) {
      await sink.publish({
        sessionId: "sessionA",
        component: "test",
        event: `event-${i}`,
        level: LogLevel.INFO,
        timestamp: Date.now(),
        payload: { index: i, blob: "x".repeat(4096) }
      });
    }
    await sink.flush?.();
    await sink.stop?.();

    const files = await fs.readdir(tempDir);
    const jsonlFiles = files.filter(file => file.endsWith(".jsonl"));
    expect(jsonlFiles.length).toBeGreaterThan(1);
  });
});

describe("webhook sink", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("retries failed requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchMock;

    const sink = createWebhookSink({
      level: LogLevel.DEBUG,
      url: "https://example.com/webhook",
      batchSize: 1,
      retry: {
        attempts: 2,
        backoffMs: 10
      }
    });

    await sink.start?.();
    await sink.publish({
      sessionId: "sessionA",
      component: "component",
      event: "webhook-event",
      level: LogLevel.INFO,
      timestamp: Date.now()
    });

    // allow retries to flush
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
