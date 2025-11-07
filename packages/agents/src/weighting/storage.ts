import fs from "node:fs/promises";
import path from "node:path";
import type { WeightSnapshot, WeightSnapshotEntry } from "../types";
import { createDefaultSnapshot } from "./engine";

export async function loadWeightSnapshot(filePath: string | null): Promise<WeightSnapshot> {
  if (!filePath) {
    return createDefaultSnapshot();
  }

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<WeightSnapshot>;
    return normalizeSnapshot(parsed);
  } catch (error) {
    if (isNotFound(error)) {
      return createDefaultSnapshot();
    }
    throw error;
  }
}

export async function saveWeightSnapshot(snapshot: WeightSnapshot, filePath: string | null): Promise<void> {
  if (!filePath) {
    return;
  }

  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  const payload = JSON.stringify(snapshot, null, 2);
  await fs.writeFile(tmpPath, payload, "utf-8");
  await fs.rename(tmpPath, filePath);
}

function normalizeSnapshot(snapshot: Partial<WeightSnapshot>): WeightSnapshot {
  const defaults = createDefaultSnapshot();
  const entries = snapshot.entries ?? {};
  const normalizedEntries: Record<string, WeightSnapshotEntry> = {};

  for (const [agentId, entry] of Object.entries(entries)) {
    normalizedEntries[agentId] = normalizeEntry(agentId, entry);
  }

  return {
    version: snapshot.version ?? defaults.version,
    updatedAt: snapshot.updatedAt ?? defaults.updatedAt,
    decayFactor: snapshot.decayFactor ?? defaults.decayFactor,
    defaultWeight: snapshot.defaultWeight ?? defaults.defaultWeight,
    entries: normalizedEntries
  };
}

function normalizeEntry(agentId: string, entry: unknown): WeightSnapshotEntry {
  if (!entry || typeof entry !== "object") {
    return {
      agentId,
      personaId: "",
      weight: 1,
      brierScore: 0.25,
      sampleCount: 0,
      updatedAt: Date.now()
    };
  }

  const record = entry as Record<string, unknown>;
  return {
    agentId,
    personaId: typeof record.personaId === "string" ? record.personaId : "",
    weight: typeof record.weight === "number" ? record.weight : 1,
    brierScore: typeof record.brierScore === "number" ? record.brierScore : 0.25,
    sampleCount: typeof record.sampleCount === "number" ? record.sampleCount : 0,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now()
  };
}

function isNotFound(error: unknown): boolean {
  return Boolean((error as NodeJS.ErrnoException)?.code === "ENOENT");
}
