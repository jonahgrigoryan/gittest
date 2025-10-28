// Temporary stub to satisfy imports before codegen runs. Will be overwritten by ts-proto.
export interface SubgameRequest { stateFingerprint?: string }
export interface SubgameResponse { actions: string[]; probabilities: number[] }

export namespace solver {
  export class SolverClient {
    // Placeholder client; real one will come from ts-proto outputServices=grpc-js
  }
}
