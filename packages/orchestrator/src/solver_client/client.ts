import { credentials, type ChannelCredentials } from "@grpc/grpc-js";
import {
  SolverClient as SolverClientConstructor,
  type SolverClient,
  type SubgameRequest,
  type SubgameResponse,
} from "@poker-bot/shared/src/gen/solver";

const DEFAULT_SOLVER_ADDR = process.env.SOLVER_ADDR ?? "127.0.0.1:50051";

export function createSolverClient(
  address: string = DEFAULT_SOLVER_ADDR,
  clientCredentials: ChannelCredentials = credentials.createInsecure(),
): SolverClient {
  return new SolverClientConstructor(address, clientCredentials);
}

export function makeRequest(stateFingerprint: string): SubgameRequest {
  return { stateFingerprint };
}

export function parseResponse(resp: SubgameResponse): string[] {
  return resp.actions ?? [];
}
