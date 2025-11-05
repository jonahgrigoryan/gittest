import { describe, it, expect, vi, beforeEach } from "vitest";
import { GTOSolver } from "../../src/solver/solver";
import type { GameState, Action } from "@poker-bot/shared";
import { createActionKey } from "@poker-bot/shared";
import { computeFingerprint } from "../../src/solver/cache/fingerprint";
import type { CacheLoader } from "../../src/solver/cache/loader";
import type { SolverClientAdapter } from "../../src/solver_client/client";
import type { ConfigurationManager } from "@poker-bot/shared/src/config/manager";

function createState(overrides: Partial<GameState> = {}): GameState {
  const players = new Map<GameState["players"] extends Map<infer P, infer S> ? [P, S][] : never>([
    ["BTN", { stack: 160, holeCards: [{ rank: "A", suit: "s" }, { rank: "Q", suit: "s" }] }],
    ["SB", { stack: 100 }],
    ["BB", { stack: 120 }],
  ]);

  const base: GameState = {
    handId: "hand-100",
    gameType: "HU_NLHE",
    blinds: { small: 1, big: 2 },
    positions: {
      hero: "BTN",
      button: "BTN",
      smallBlind: "BTN",
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
    latency: 0,
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

function createCacheQuery(state: GameState, action?: Action) {
  const selectedAction = action ?? { type: "raise", amount: 6, position: state.positions.hero, street: state.street };
  const entry = {
    action: selectedAction,
    solution: { frequency: 1, ev: 1.2, regret: 0 },
  };
  return {
    fingerprint: computeFingerprint(state),
    actions: new Map([[createActionKey(selectedAction), entry]]),
    exploitability: 0.02,
    computeTime: 10,
    source: "cache" as const,
  };
}

describe("GTOSolver", () => {
  const configManager = {
    get: vi.fn((key: string) => {
      if (key === "gto.subgameBudgetMs") {
        return 400;
      }
      if (key === "gto.deepStackThreshold") {
        return 100;
      }
      throw new Error(`Unexpected config key ${key}`);
    }),
  } as unknown as ConfigurationManager;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns cached solution when available", async () => {
    const state = createState();
    const cacheLoader = {
      queryCache: vi.fn(() => createCacheQuery(state)),
      queryApproximate: vi.fn(() => null),
      getManifest: vi.fn(),
    } as unknown as CacheLoader;
    const solveMock = vi.fn();
    const solverClient = {
      solve: solveMock,
      close: vi.fn(),
    } as unknown as SolverClientAdapter;

    const solver = new GTOSolver(configManager, { cacheLoader, solverClient }, { logger: console });
    const result = await solver.solve(state, 400);

    expect(result.source).toBe("cache");
    expect(result.actions.size).toBeGreaterThan(0);
    expect(solveMock).not.toHaveBeenCalled();
  });

  it("calls subgame solver when cache misses", async () => {
    const state = createState();
    const cacheLoader = {
      queryCache: vi.fn(() => null),
      queryApproximate: vi.fn(() => null),
      getManifest: vi.fn(),
    } as unknown as CacheLoader;
    const solveMock = vi.fn(async () => ({
      actions: [
        {
          actionType: "raise",
          amount: 6,
          frequency: 0.6,
          ev: 0.8,
          regret: 0.1,
        },
        {
          actionType: "call",
          amount: 2,
          frequency: 0.4,
          ev: 0.5,
          regret: 0.05,
        },
      ],
      exploitability: 0.04,
      computeTimeMs: 120,
      source: "subgame",
    }));
    const solverClient = {
      solve: solveMock,
      close: vi.fn(),
    } as unknown as SolverClientAdapter;

    const solver = new GTOSolver(configManager, { cacheLoader, solverClient }, { logger: console });
    const result = await solver.solve(state, 400);

    expect(result.source).toBe("subgame");
    expect(result.actions.size).toBe(2);
    expect(solveMock).toHaveBeenCalledTimes(1);
  });

  it("returns safe fallback when budget exhausted", async () => {
    const state = createState();
    const cacheLoader = {
      queryCache: vi.fn(() => null),
      queryApproximate: vi.fn(() => null),
      getManifest: vi.fn(),
    } as unknown as CacheLoader;
    const solveMock = vi.fn();
    const solverClient = {
      solve: solveMock,
      close: vi.fn(),
    } as unknown as SolverClientAdapter;

    const solver = new GTOSolver(configManager, { cacheLoader, solverClient }, { logger: console });
    const result = await solver.solve(state, 0);

    expect(result.actions.size).toBe(1);
    const [[, entry]] = Array.from(result.actions.entries());
    expect(entry.solution.frequency).toBe(1);
    expect(entry.action.type === "call" || entry.action.type === "fold").toBe(true);
  });

  it("falls back to approximate cache when solver call fails", async () => {
    const state = createState();
    const cacheLoader = {
      queryCache: vi.fn(() => null),
      queryApproximate: vi.fn(() => createCacheQuery(state, {
        type: "call",
        amount: 2,
        position: state.positions.hero,
        street: state.street,
      })),
      getManifest: vi.fn(),
    } as unknown as CacheLoader;
    const solveMock = vi.fn(async () => {
      throw new Error("solver offline");
    });
    const solverClient = {
      solve: solveMock,
      close: vi.fn(),
    } as unknown as SolverClientAdapter;

    const solver = new GTOSolver(configManager, { cacheLoader, solverClient }, { logger: console });
    const result = await solver.solve(state, 400);

    expect(result.source).toBe("cache");
    expect(result.actions.size).toBe(1);
  });
});
