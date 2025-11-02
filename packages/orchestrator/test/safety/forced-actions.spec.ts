import { describe, expect, it } from "vitest";

import { detectForcedAction, isForcedAllIn, isForcedBlind } from "../../src/safety/forced-actions";
import { createParsedState } from "../utils/factories";

describe("Forced Action Handling", () => {
  it("detects forced small blind", () => {
    const state = createParsedState();
    const action = detectForcedAction(state, "SB");
    expect(action).toEqual({ type: "call", amount: 1, position: "SB", street: "preflop" });
  });

  it("detects forced big blind", () => {
    const base = createParsedState({
      positions: { hero: "BB", button: "BTN", smallBlind: "SB", bigBlind: "BB" }
    });
    const action = detectForcedAction(base, "BB");
    expect(action).toEqual({ type: "call", amount: 2, position: "BB", street: "preflop" });
  });

  it("detects forced all-in", () => {
    const source = createParsedState();
    const players = new Map(source.players);
    players.set("SB", { stack: 1 });
    const state = createParsedState({
      players,
      actionHistory: [{ type: "raise", amount: 5, position: "UTG", street: "preflop" }]
    });

    expect(isForcedAllIn(state, "SB")).toBe(true);
    const action = detectForcedAction(state, "SB");
    expect(action).toEqual({ type: "call", amount: 1, position: "SB", street: "preflop" });
  });

  it("posts blinds automatically", () => {
    const state = createParsedState();
    expect(isForcedBlind(state, "SB")).toBe(true);
    expect(isForcedBlind(state, "BB")).toBe(true);
  });

  it("does not override forced actions with SafeAction", () => {
    const state = createParsedState();
    const action = detectForcedAction(state, state.positions.hero);
    expect(action).not.toBeNull();
    expect(action?.type).toBe("call");
  });
});
