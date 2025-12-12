import path from "node:path";
import { createActionKey, type GameState, type GTOSolution } from "@poker-bot/shared/src/types";
import type { CacheLoaderOptions, CacheManifest, CacheIndexEntry, CacheQuery } from "./types";
import { SUPPORTED_CACHE_STREETS } from "./types";
import { computeFingerprint } from "./fingerprint";
import { loadManifest, validateManifest, loadCacheEntries } from "./storage";

export class CacheLoader {
  private readonly index = new Map<string, CacheIndexEntry>();
  private readonly streetIndex = new Map<string, CacheIndexEntry[]>();
  private manifest?: CacheManifest;
  private readonly logger: NonNullable<CacheLoaderOptions["logger"]>;
  private loaded = false;

  constructor(private readonly rootPath: string, private readonly options: CacheLoaderOptions = {}) {
    this.logger = options.logger ?? console;
  }

  async loadCache(): Promise<void> {
    const manifest = await loadManifest(this.rootPath, this.options);
    if (manifest && validateManifest(manifest, this.options)) {
      this.manifest = manifest;
    } else if (manifest) {
      this.logger.error(`Cache manifest validation failed for ${path.resolve(this.rootPath)}. Cache will be ignored.`);
      this.index.clear();
      this.streetIndex.clear();
      this.loaded = true;
      return;
    }

    const entries = await loadCacheEntries(this.rootPath, this.options);
    for (const entry of entries) {
      this.index.set(entry.fingerprint, entry);
      const streetEntries = this.streetIndex.get(entry.street) ?? [];
      streetEntries.push(entry);
      this.streetIndex.set(entry.street, streetEntries);
    }
    this.loaded = true;
    this.logger.info?.(`Loaded ${entries.length} cache entries from ${this.rootPath}`);
  }

  queryCache(state: GameState): CacheQuery | null {
    if (!this.loaded) {
      throw new Error("Cache not loaded. Call loadCache() before querying.");
    }
    if (!SUPPORTED_CACHE_STREETS.has(state.street)) {
      return null;
    }
    const fingerprint = computeFingerprint(state);
    const entry = this.index.get(fingerprint);
    if (!entry) {
      return null;
    }
    return this.buildSolution(entry);
  }

  queryApproximate(state: GameState): CacheQuery | null {
    if (!this.loaded) {
      throw new Error("Cache not loaded. Call loadCache() before querying.");
    }
    if (!SUPPORTED_CACHE_STREETS.has(state.street)) {
      return null;
    }
    const streetEntries = this.streetIndex.get(state.street);
    if (!streetEntries || streetEntries.length === 0) {
      return null;
    }
    const heroPosition = state.positions.hero;
    const matching = streetEntries.find((entry) => entry.record.actions.some((action) => action.action.position === heroPosition));
    const selected = matching ?? streetEntries[0];
    return this.buildSolution(selected);
  }

  getManifest(): CacheManifest | undefined {
    return this.manifest;
  }

  private buildSolution(entry: CacheIndexEntry): CacheQuery {
    const actions = new Map<string, CacheIndexEntry["record"]["actions"][number]>();
    for (const actionEntry of entry.record.actions) {
      const key = createActionKey(actionEntry.action);
      actions.set(key, actionEntry);
    }
    const graph = new Map(actions);
    return {
      fingerprint: entry.fingerprint,
      actions: graph,
      exploitability: entry.record.exploitability,
      computeTime: entry.record.computeTimeMs,
      source: "cache",
    } satisfies CacheQuery;
  }
}

export function solutionToGtO(solution: CacheQuery): GTOSolution {
  return {
    actions: solution.actions,
    exploitability: solution.exploitability,
    computeTime: solution.computeTime,
    source: solution.source,
  } satisfies GTOSolution;
}
