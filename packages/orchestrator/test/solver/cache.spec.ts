import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { computeFingerprint } from "../../src/solver/cache/fingerprint";
import { CacheLoader, solutionToGtO } from "../../src/solver/cache/loader";
import { CACHE_VERSION, FINGERPRINT_ALGORITHM, CACHE_COMPRESSION } from "../../src/solver/cache/types";
import type { GameState, Action } from "@poker-bot/shared";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function createGameState(overrides: Partial<GameState> = {}): GameState {
  const players = new Map<GameState["players"] extends Map<infer P, infer S> ? [P, S][] : never>([
    ["BTN", { stack: 200, holeCards: [{ rank: "A", suit: "s" }, { rank: "K", suit: "s" }] }],
    ["SB", { stack: 100 }],
    ["BB", { stack: 100 }],
  ]);
  const base: GameState = {
    handId: "hand-001",
    gameType: "HU_NLHE",
    blinds: { small: 1, big: 2 },
    positions: {
      hero: "BTN",
      button: "BTN",
      smallBlind: "SB",
      bigBlind: "BB",
    },
    players,
    communityCards: [],
    pot: 3,
    street: "preflop",
    actionHistory: [],
    legalActions: [
      { type: "fold", position: "BTN", street: "preflop" },
      { type: "call", amount: 2, position: "BTN", street: "preflop" },
      { type: "raise", amount: 6, position: "BTN", street: "preflop" },
    ],
    confidence: { overall: 1, perElement: new Map() },
    latency: 10,
  };

  return {
    ...base,
    ...overrides,
    players: overrides.players ?? players,
    communityCards: overrides.communityCards ?? base.communityCards,
    actionHistory: overrides.actionHistory ?? base.actionHistory,
    legalActions: overrides.legalActions ?? base.legalActions,
  };
}

async function writeCacheFile(root: string, state: GameState) {
  const fingerprint = computeFingerprint(state);
  const manifestPath = path.join(root, "cache_manifest.json");
  const manifest = {
    version: CACHE_VERSION,
    fingerprint: FINGERPRINT_ALGORITHM,
    compression: CACHE_COMPRESSION,
    streets: ["preflop"],
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest));

  const entryDir = path.join(root, "preflop", "HU_NLHE", "100bb");
  await fs.mkdir(entryDir, { recursive: true });
  const actions = [
    {
      action: { type: "raise", amount: 6, position: "BTN", street: "preflop" } satisfies Action,
      solution: { frequency: 0.7, ev: 1.2, regret: 0.01 },
    },
    {
      action: { type: "call", amount: 2, position: "BTN", street: "preflop" } satisfies Action,
      solution: { frequency: 0.3, ev: 0.6, regret: 0.05 },
    },
  ];
  const cachePayload = {
    version: CACHE_VERSION,
    fingerprint,
    exploitability: 0.03,
    computeTimeMs: 14,
    actions,
  };
  await fs.writeFile(path.join(entryDir, "sample.bin"), JSON.stringify(cachePayload));

  return { fingerprint };
}

describe("solver cache", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gto-cache-"));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("produces stable fingerprints for identical states", () => {
    const stateA = createGameState();
    const stateB = createGameState();

    expect(computeFingerprint(stateA)).toEqual(computeFingerprint(stateB));
  });

  it("produces different fingerprints when action history differs", () => {
    const state = createGameState();
    const modified = createGameState({
      actionHistory: [{ type: "raise", amount: 6, position: "BTN", street: "preflop" }],
    });

    expect(computeFingerprint(state)).not.toEqual(computeFingerprint(modified));
  });

  it("loads cache entries and returns matching solution", async () => {
    const state = createGameState();
    const { fingerprint } = await writeCacheFile(tmpDir, state);
    const loader = new CacheLoader(tmpDir, { logger: console });
    await loader.loadCache();

    const hit = loader.queryCache(state);
    expect(hit).not.toBeNull();
    const solution = hit && solutionToGtO(hit);
    expect(solution?.source).toBe("cache");
    expect(solution?.actions.size).toBeGreaterThan(0);
    expect(hit?.fingerprint).toBe(fingerprint);
  });
});
