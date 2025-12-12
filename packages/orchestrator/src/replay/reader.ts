import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { HandRecord } from "@poker-bot/shared/src/strategy";

export interface ReadHandRecordsOptions {
  sessionDir?: string;
  handId?: string;
  limit?: number;
  offset?: number;
}

export async function* readHandRecords(
  filePath: string,
  options: ReadHandRecordsOptions = {}
): AsyncGenerator<HandRecord, void, void> {
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let yielded = 0;
  let skipped = 0;

  try {
    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }
      let record: HandRecord;
      try {
        record = JSON.parse(line) as HandRecord;
      } catch (error) {
        console.warn("Replay reader: failed to parse HandRecord line", {
          filePath,
          error: error instanceof Error ? error.message : error
        });
        continue;
      }

      if (options.handId && record.handId !== options.handId) {
        continue;
      }

      if (options.offset && skipped < options.offset) {
        skipped += 1;
        continue;
      }

      yield record;
      yielded += 1;

      if (options.limit && yielded >= options.limit) {
        break;
      }
    }
  } finally {
    rl.close();
    stream.close();
  }
}

export async function findHandRecordFile(
  sessionId: string,
  resultsDir: string,
  sessionPrefix?: string
): Promise<string | null> {
  let candidateDir: string | null = null;
  const directories = await readdir(resultsDir, { withFileTypes: true });
  const expectedName = sessionPrefix ? `${sessionPrefix}_${sessionId}` : null;

  for (const entry of directories) {
    if (!entry.isDirectory()) continue;
    if (expectedName) {
      if (entry.name === expectedName) {
        candidateDir = path.join(resultsDir, entry.name);
        break;
      }
    } else if (entry.name.endsWith(`_${sessionId}`)) {
      candidateDir = path.join(resultsDir, entry.name);
      break;
    }
  }

  if (!candidateDir && expectedName) {
    for (const entry of directories) {
      if (!entry.isDirectory()) continue;
      if (entry.name.endsWith(`_${sessionId}`)) {
        candidateDir = path.join(resultsDir, entry.name);
        break;
      }
    }
  }

  if (!candidateDir) {
    return null;
  }

  const files = await readdir(candidateDir, { withFileTypes: true });
  const jsonl = files.find(entry => entry.isFile() && entry.name.endsWith(".jsonl"));
  if (!jsonl) {
    return null;
  }
  return path.join(candidateDir, jsonl.name);
}
