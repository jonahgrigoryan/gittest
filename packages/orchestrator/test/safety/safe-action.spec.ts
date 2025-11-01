import { describe, expect, it } from "vitest";

import type { Action } from "@poker-bot/shared";
import { selectSafeAction } from "../../src/safety/safe-action";
import { createParsedState } from "../utils/factories";

describe("SafeAction Selection", () => {
  it("selects check preflop when legal", () => {
    const state = createParsedState();
    const action = selectSafeAction(state);
    expect(action.type).toBe("check");
  });

  it("selects fold preflop when check not legal", () => {
    const legalActions: Action[] = [
      { type: "call", amount: 2, position: "SB", street: "preflop" },
      { type: "fold", position: "SB", street: "preflop" }
    ];
    const state = createParsedState({ legalActions });
    const action = selectSafeAction(state);
    expect(action.type).toBe("fold");
  });

  it("selects check postflop when legal", () => {
    const legalActions: Action[] = [
      { type: "check", position: "SB", street: "flop" },
      { type: "fold", position: "SB", street: "flop" }
    ];
    const state = createParsedState({ street: "flop", legalActions });
    const action = selectSafeAction(state);
    expect(action.type).toBe("check");
    expect(action.street).toBe("flop");
  });

  it("selects fold postflop when check not legal", () => {
    const legalActions: Action[] = [
      { type: "call", amount: 5, position: "SB", street: "turn" },
      { type: "fold", position: "SB", street: "turn" }
    ];
    const state = createParsedState({ street: "turn", legalActions });
    const action = selectSafeAction(state);
    expect(action.type).toBe("fold");
  });

  it("never selects raise in safe mode", () => {
    const legalActions: Action[] = [
      { type: "raise", amount: 20, position: "SB", street: "river" },
      { type: "call", amount: 10, position: "SB", street: "river" },
      { type: "fold", position: "SB", street: "river" }
    ];
    const state = createParsedState({ street: "river", legalActions });
    const action = selectSafeAction(state);
    expect(action.type).toBe("fold");
  });
});
