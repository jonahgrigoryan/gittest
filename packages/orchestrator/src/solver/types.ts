import type { GameState, GTOSolution } from "@poker-bot/shared/src/types";
import type { SolverClientAdapter, SolverCallResult } from "../solver_client/client";
import type { CacheLoader } from "./cache/loader";
import type { ActionSizing } from "./deep_stack";

export interface GTOSolverDependencies {
  cacheLoader: CacheLoader;
  solverClient: SolverClientAdapter;
}

export interface GTOSolverOptions {
  logger?: Pick<typeof console, "debug" | "info" | "warn" | "error">;
  now?: () => number;
}

export interface SolveParams {
  state: GameState;
  budgetMs: number;
  allowApproximateCache?: boolean;
}

export interface SubgameSolveInput {
  fingerprint: string;
  state: GameState;
  budgetMs: number;
  actionSet: ActionSizing[];
  effectiveStackBb: number;
}

export interface SubgameSolveResult extends GTOSolution {
  fingerprint: string;
  raw: SolverCallResult;
}
