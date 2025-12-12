import type { ActionSolutionEntry, GTOSolution, Street } from "@poker-bot/shared/src/types";

export const CACHE_VERSION = "1.0.0";
export const FINGERPRINT_ALGORITHM = "sha256-v1";
export const CACHE_COMPRESSION = "zlib";
export const SUPPORTED_CACHE_STREETS: ReadonlySet<Street> = new Set(["preflop", "flop"]);

export interface CacheManifest {
  version: string;
  fingerprint: string;
  compression: string;
  streets: Street[];
  createdAt?: string;
}

export interface CacheStrategyRecord {
  fingerprint: string;
  actions: ActionSolutionEntry[];
  exploitability: number;
  computeTimeMs: number;
}

export interface CacheIndexEntry {
  fingerprint: string;
  filePath: string;
  record: CacheStrategyRecord;
  street: Street;
}

export interface CacheLoaderResult {
  manifest?: CacheManifest;
  entries: CacheIndexEntry[];
}

export type CacheQuery = GTOSolution & { fingerprint: string };

export interface CacheLoaderOptions {
  logger?: Pick<typeof console, "debug" | "info" | "warn" | "error">;
}
