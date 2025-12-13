import type { ConfigurationManager } from "@poker-bot/shared";
import { createActionKey, type Action, type ActionSolutionEntry, type GameState, type GTOSolution } from "@poker-bot/shared";
import { CacheLoader, solutionToGtO } from "./cache/loader";
import { computeFingerprint } from "./cache/fingerprint";
import { actionSetToStrings, calculateEffectiveStack, selectActionSet } from "./deep_stack";
import type { GTOSolverDependencies, GTOSolverOptions, SubgameSolveInput } from "./types";
import { makeRequest, parseResponse } from "../solver_client/client";
import type { SolverClientAdapter } from "../solver_client/client";

const SAFE_EXPLOITABILITY_PENALTY = 1;

export class GTOSolver {
  private readonly cacheLoader: CacheLoader;
  private readonly solverClient: SolverClientAdapter;
  private readonly logger: NonNullable<GTOSolverOptions["logger"]>;
  private readonly now: () => number;

  constructor(
    private readonly configManager: ConfigurationManager,
    deps: GTOSolverDependencies,
    options: GTOSolverOptions = {},
  ) {
    this.cacheLoader = deps.cacheLoader;
    this.solverClient = deps.solverClient;
    this.logger = options.logger ?? console;
    this.now = options.now ?? Date.now;
  }

  async solve(state: GameState, explicitBudgetMs?: number): Promise<GTOSolution> {
    const defaultBudget = this.configManager.get<number>("gto.subgameBudgetMs");
    const budgetMs = explicitBudgetMs ?? defaultBudget;

    const cacheSolution = this.tryCacheLookup(state);
    if (cacheSolution.hit) {
      return cacheSolution.hit;
    }

    if (budgetMs <= 0) {
      this.logger.warn?.("Budget exhausted before subgame solve. Using cache or safe fallback.");
      const approx = cacheSolution.approximate;
      if (approx) {
        return approx;
      }
      return this.buildSafeFallback(state);
    }

    const subgameInput = this.buildSubgameInput(state, budgetMs);
    try {
      const startTime = this.now();
      const request = makeRequest({
        stateFingerprint: subgameInput.fingerprint,
        gameStateJson: serializeGameState(subgameInput.state),
        budgetMs: subgameInput.budgetMs,
        effectiveStackBb: Math.round(subgameInput.effectiveStackBb),
        actionSet: actionSetToStrings(subgameInput.actionSet),
      });
      const response = await this.solverClient.solve(request);
      const elapsed = this.now() - startTime;
      const parsed = parseResponse(response);
      return this.mapResponseToSolution(parsed, state, elapsed);
    } catch (error) {
      this.logger.error?.("Subgame solver call failed, falling back to cache or safe action", error);
      const approx = cacheSolution.approximate;
      if (approx) {
        return approx;
      }
      return this.buildSafeFallback(state);
    }
  }

  private tryCacheLookup(state: GameState): { hit?: GTOSolution; approximate?: GTOSolution } {
    if (!this.shouldUseCache(state)) {
      return {};
    }
    let hit: GTOSolution | undefined;
    try {
      const cacheQuery = this.cacheLoader.queryCache(state);
      if (cacheQuery) {
        hit = solutionToGtO(cacheQuery);
      }
    } catch (error) {
      this.logger.warn?.("Cache lookup failed", error);
    }

    if (hit) {
      return { hit };
    }

    try {
      const approximate = this.cacheLoader.queryApproximate(state);
      if (approximate) {
        return { approximate: solutionToGtO(approximate) };
      }
    } catch (error) {
      this.logger.warn?.("Approximate cache lookup failed", error);
    }
    return {};
  }

  private mapResponseToSolution(parsed: ReturnType<typeof parseResponse>, state: GameState, elapsedMs: number): GTOSolution {
    const entries = parsed.actions.map((actionProb) => this.toActionEntry(actionProb, state));
    const map = new Map<string, ActionSolutionEntry>();
    for (const entry of entries) {
      map.set(createActionKey(entry.action), entry);
    }
    return {
      actions: map,
      exploitability: parsed.exploitability,
      computeTime: parsed.computeTimeMs || elapsedMs,
      source: parsed.source,
    } satisfies GTOSolution;
  }

  private toActionEntry(parsed: ReturnType<typeof parseResponse>["actions"][number], state: GameState): ActionSolutionEntry {
    const action: Action = {
      type: parsed.type,
      amount: parsed.amount,
      position: state.positions.hero,
      street: state.street,
    };
    return {
      action,
      solution: {
        frequency: parsed.frequency,
        ev: parsed.ev,
        regret: parsed.regret,
      },
    } satisfies ActionSolutionEntry;
  }

  private buildSubgameInput(state: GameState, budgetMs: number): SubgameSolveInput {
    const fingerprint = computeFingerprint(state);
    const effectiveStackBb = calculateEffectiveStack(state);
    const threshold = this.configManager.get<number>("gto.deepStackThreshold");
    const actionSet = selectActionSet(effectiveStackBb, threshold);
    return {
      fingerprint,
      state,
      budgetMs,
      actionSet,
      effectiveStackBb,
    } satisfies SubgameSolveInput;
  }

  private shouldUseCache(state: GameState): boolean {
    return state.street === "preflop" || state.street === "flop";
  }

  private buildSafeFallback(state: GameState): GTOSolution {
    const heroPosition = state.positions.hero;
    const preferred = state.legalActions.find((action) => action.position === heroPosition && (action.type === "check" || action.type === "call"));
    const fallback = preferred ?? state.legalActions.find((action) => action.position === heroPosition)
      ?? {
        type: "fold",
        position: heroPosition,
        street: state.street,
      };
    const entry: ActionSolutionEntry = {
      action: fallback,
      solution: {
        frequency: 1,
        ev: 0,
        regret: 0,
      },
    };
    return {
      actions: new Map([[createActionKey(entry.action), entry]]),
      exploitability: SAFE_EXPLOITABILITY_PENALTY,
      computeTime: 0,
      source: "subgame",
    } satisfies GTOSolution;
  }
}

function serializeGameState(state: GameState): string {
  return JSON.stringify(state, (_key, value) => {
    if (value instanceof Map) {
      return Object.fromEntries(value.entries());
    }
    return value;
  });
}
