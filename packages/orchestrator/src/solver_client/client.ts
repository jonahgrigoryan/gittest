import { credentials, type ChannelCredentials } from "@grpc/grpc-js";
import type { ActionType } from "@poker-bot/shared";
import {
  SolverClient as SolverClientConstructor,
  type SolverClient,
  type SubgameRequest,
  type SubgameResponse,
} from "@poker-bot/shared/src/gen/solver";

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
  close(): void;
}

export function createSolverClient(
  address: string = DEFAULT_SOLVER_ADDR,
  clientCredentials: ChannelCredentials = credentials.createInsecure(),
): SolverClientAdapter {
  const client = new SolverClientConstructor(address, clientCredentials);
  return new GrpcSolverClient(client);
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
  constructor(private readonly client: SolverClient) {}

  solve(request: SubgameRequest): Promise<SubgameResponse> {
    return new Promise((resolve, reject) => {
      this.client.solve(request, (error, response) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(response);
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
