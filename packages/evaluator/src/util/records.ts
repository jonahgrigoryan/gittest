import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import type { HandRecord } from "@poker-bot/shared";

export async function* readHandRecords(
  filePath: string,
): AsyncGenerator<HandRecord> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as HandRecord;
      yield parsed;
    } catch (error) {
      console.warn(`Skipping invalid line in ${filePath}:`, error);
    }
  }
}

export async function resolveSessionFile(
  handsDir: string,
  sessionId?: string,
): Promise<string> {
  const base = path.resolve(handsDir);
  if (sessionId) {
    const candidate = path.join(
      base,
      `session_${sessionId}`,
      "hand_records.jsonl",
    );
    return candidate;
  }

  const entries = await readdir(base, { withFileTypes: true });
  const sessionDirs = entries.filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("session_"),
  );
  if (!sessionDirs.length) {
    throw new Error(`No session directories found under ${base}`);
  }
  sessionDirs.sort((a, b) => b.name.localeCompare(a.name));
  const latest = sessionDirs[0];
  return path.join(base, latest.name, "hand_records.jsonl");
}

export async function ensureOutputDir(
  outputDir: string,
  runId: string,
): Promise<string> {
  const resolved = path.resolve(outputDir, runId);
  await import("node:fs/promises").then((fs) =>
    fs.mkdir(resolved, { recursive: true }),
  );
  return resolved;
}
