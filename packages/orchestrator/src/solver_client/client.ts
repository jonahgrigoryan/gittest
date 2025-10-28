import type { SubgameRequest, SubgameResponse } from "@poker-bot/shared/src/gen/solver";

export function makeRequest(stateFingerprint: string): SubgameRequest {
  return { stateFingerprint } as SubgameRequest;
}

export function parseResponse(resp: SubgameResponse): string[] {
  return resp.actions || [];
}
