import {
  credentials,
  type ChannelCredentials,
  type ClientUnaryCall,
} from "@grpc/grpc-js";
import type { ActionType } from "@poker-bot/shared";
import { solverGen } from "@poker-bot/shared";
type SolverClient = solverGen.SolverClient;
type SubgameRequest = solverGen.SubgameRequest;
type SubgameResponse = solverGen.SubgameResponse;

const SolverClientConstructor = solverGen.SolverClient;

const DEFAULT_SOLVER_ADDR = process.env.SOLVER_ADDR ?? "127.0.0.1:50051";

export interface SolverCallResult {
  actions: ParsedActionProb[];
  exploitability: number;
  computeTimeMs: number;
  source: "cache" | "subgame";
}

export interface ParsedActionProb {
  type: ActionType;
  amount?: number;
  frequency: number;
  ev: number;
  regret?: number;
}

export interface SolverClientAdapter {
  solve(request: SubgameRequest): Promise<SubgameResponse>;
  waitForReady(timeoutMs?: number): Promise<void>;
  close(): void;
}

export function createSolverClient(
  address: string = DEFAULT_SOLVER_ADDR,
  clientCredentials: ChannelCredentials = credentials.createInsecure(),
  timeoutMs: number = 30000,
): SolverClientAdapter {
  const client = new SolverClientConstructor(address, clientCredentials);
  return new GrpcSolverClient(client, timeoutMs);
}

export function makeRequest(params: {
  stateFingerprint: string;
  gameStateJson: string;
  budgetMs: number;
  effectiveStackBb: number;
  actionSet: string[];
}): SubgameRequest {
  return {
    stateFingerprint: params.stateFingerprint,
    gameStateJson: params.gameStateJson,
    budgetMs: params.budgetMs,
    effectiveStackBb: params.effectiveStackBb,
    actionSet: params.actionSet,
  };
}

export function parseResponse(resp: SubgameResponse): SolverCallResult {
  return {
    actions: (resp.actions ?? []).map((action) => ({
      type: normalizeActionType(action.actionType),
      amount: action.amount,
      frequency: action.frequency,
      ev: action.ev,
      regret: action.regret,
    })),
    exploitability: resp.exploitability ?? 0,
    computeTimeMs: resp.computeTimeMs ?? 0,
    source: resp.source === "cache" ? "cache" : "subgame",
  };
}

class GrpcSolverClient implements SolverClientAdapter {
  constructor(
    private readonly client: SolverClient,
    private readonly timeoutMs: number,
  ) {}

  solve(request: SubgameRequest): Promise<SubgameResponse> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let call: ClientUnaryCall | undefined;

    const callPromise = new Promise<SubgameResponse>((resolve, reject) => {
      call = this.client.solve(request, (error, response) => {
        if (error) {
          reject(error);
          return;
        }
        if (!response) {
          reject(new Error("Solver response was empty"));
          return;
        }
        resolve(response);
      });
    });

    if (this.timeoutMs <= 0) {
      return callPromise;
    }

    const timeoutPromise = new Promise<SubgameResponse>((_, reject) => {
      timeoutId = setTimeout(() => {
        if (call) {
          call.cancel();
        }
        reject(new Error(`Solver request timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });

    return Promise.race([callPromise, timeoutPromise]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });
  }

  waitForReady(timeoutMs: number = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      this.client.waitForReady(deadline, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  close(): void {
    this.client.close();
  }
}

function normalizeActionType(actionType: string): ActionType {
  switch (actionType) {
    case "fold":
    case "check":
    case "call":
    case "raise":
      return actionType;
    default:
      return "fold";
  }
}
