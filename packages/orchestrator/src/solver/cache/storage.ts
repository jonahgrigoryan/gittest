import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import type { Action, ActionSolutionEntry, Street } from "@poker-bot/shared";
import { CACHE_COMPRESSION, CACHE_VERSION, FINGERPRINT_ALGORITHM, SUPPORTED_CACHE_STREETS, type CacheLoaderOptions, type CacheManifest, type CacheStrategyRecord, type CacheIndexEntry } from "./types";

const gunzipAsync = promisify(gunzip);

interface SerializedCacheAction {
  action: ActionSolutionEntry["action"];
  solution: ActionSolutionEntry["solution"];
}

interface SerializedCacheFile {
  version: string;
  fingerprint: string;
  exploitability: number;
  computeTimeMs: number;
  actions: SerializedCacheAction[];
}

const MANIFEST_FILENAME = "cache_manifest.json";

export async function loadManifest(rootPath: string, options: CacheLoaderOptions = {}): Promise<CacheManifest | undefined> {
  const manifestPath = path.join(rootPath, MANIFEST_FILENAME);
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(raw) as CacheManifest;
    return parsed;
  } catch (error) {
    options.logger?.warn?.(`Cache manifest missing or unreadable at ${manifestPath}:`, error);
    return undefined;
  }
}

export function validateManifest(manifest: CacheManifest, options: CacheLoaderOptions = {}): boolean {
  if (manifest.version !== CACHE_VERSION) {
    options.logger?.error?.(`Cache manifest version mismatch: expected ${CACHE_VERSION}, received ${manifest.version}`);
    return false;
  }
  if (manifest.fingerprint !== FINGERPRINT_ALGORITHM) {
    options.logger?.error?.(`Cache manifest fingerprint algorithm mismatch: expected ${FINGERPRINT_ALGORITHM}, received ${manifest.fingerprint}`);
    return false;
  }
  if (manifest.compression !== CACHE_COMPRESSION) {
    options.logger?.error?.(`Cache manifest compression mismatch: expected ${CACHE_COMPRESSION}, received ${manifest.compression}`);
    return false;
  }
  const streets = manifest.streets ?? [];
  const supported = streets.every((street) => SUPPORTED_CACHE_STREETS.has(street));
  if (!supported) {
    options.logger?.warn?.(`Cache manifest enumerates unsupported streets: ${streets.join(", ")}`);
  }
  return true;
}

export async function loadCacheEntries(rootPath: string, options: CacheLoaderOptions = {}): Promise<CacheIndexEntry[]> {
  const entries: CacheIndexEntry[] = [];
  for (const street of SUPPORTED_CACHE_STREETS) {
    const streetEntries = await loadStreetCache(rootPath, street, options);
    entries.push(...streetEntries);
  }
  return entries;
}

async function loadStreetCache(rootPath: string, street: Street, options: CacheLoaderOptions): Promise<CacheIndexEntry[]> {
  const streetPath = path.join(rootPath, street);
  if (!(await exists(streetPath))) {
    return [createSyntheticEntry(rootPath, street)];
  }
  const discoveredFiles = await discoverBinaryFiles(streetPath);
  const indexEntries: CacheIndexEntry[] = [];
  for (const filePath of discoveredFiles) {
    try {
      const record = await readCacheFile(filePath, options);
      if (!record) {
        continue;
      }
      indexEntries.push({
        fingerprint: record.fingerprint,
        filePath,
        record,
        street,
      });
    } catch (error) {
      options.logger?.warn?.(`Failed to load cache file ${filePath}:`, error);
    }
  }
  if (indexEntries.length === 0) {
    options.logger?.info?.(`No cache files found for ${street}. Seeding synthetic entry for approximate lookups.`);
    indexEntries.push(createSyntheticEntry(rootPath, street));
  }
  return indexEntries;
}

async function readCacheFile(filePath: string, options: CacheLoaderOptions): Promise<CacheStrategyRecord | undefined> {
  const raw = await fs.readFile(filePath);
  let payload: Buffer;
  try {
    payload = await gunzipAsync(raw);
  } catch (error) {
    options.logger?.warn?.(
      `Cache file ${filePath} is not compressed with ${CACHE_COMPRESSION}, attempting plain parse.`,
      error,
    );
    payload = raw;
  }
  const parsed = JSON.parse(payload.toString("utf-8")) as SerializedCacheFile;
  if (parsed.version !== CACHE_VERSION) {
    options.logger?.warn?.(`Cache file ${filePath} version mismatch: expected ${CACHE_VERSION}, received ${parsed.version}`);
  }
  return {
    fingerprint: parsed.fingerprint,
    actions: parsed.actions.map((entry) => ({ action: entry.action, solution: entry.solution })),
    exploitability: parsed.exploitability,
    computeTimeMs: parsed.computeTimeMs,
  };
}

function createSyntheticEntry(rootPath: string, street: Street): CacheIndexEntry {
  const actions = syntheticActionsForStreet(street);
  return {
    fingerprint: `synthetic-${street}`,
    filePath: path.join(rootPath, street, "synthetic.bin"),
    street,
    record: {
      fingerprint: `synthetic-${street}`,
      actions,
      exploitability: 0.1,
      computeTimeMs: 5,
    },
  };
}

function syntheticActionsForStreet(street: Street): ActionSolutionEntry[] {
  const hero: Action["position"] = street === "preflop" ? "BTN" : "SB";
  const baseActions: Action[] = street === "preflop"
    ? [
        { type: "fold", position: hero, street },
        { type: "call", amount: 2, position: hero, street },
        { type: "raise", amount: 6, position: hero, street },
      ]
    : [
        { type: "check", position: hero, street },
        { type: "raise", amount: 6, position: hero, street },
      ];

  return baseActions.map((action, index) => ({
    action,
    solution: {
      frequency: street === "preflop" ? [0.2, 0.5, 0.3][index] ?? 0.5 : index === 0 ? 0.6 : 0.4,
      ev: index as number * 0.1,
      regret: 0.01 * (index as number + 1),
    },
  }));
}

async function discoverBinaryFiles(directory: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const child = await discoverBinaryFiles(entryPath);
      results.push(...child);
    } else if (entry.isFile() && entry.name.endsWith(".bin")) {
      results.push(entryPath);
    }
  }
  return results;
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
