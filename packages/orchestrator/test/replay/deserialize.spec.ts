import { describe, it, expect } from "vitest";
import type { GameState, Card } from "@poker-bot/shared";
import { serializeGameState } from "@poker-bot/shared";
import { deserializeGameState } from "../../src/replay/deserialize";

describe("deserializeGameState", () => {
  it("round-trips serialized game state", () => {
    const state: GameState = {
      handId: "hand-rt-1",
      gameType: "NLHE_6max",
      blinds: { small: 1, big: 2 },
      positions: {
        hero: "BTN",
        button: "BTN",
        smallBlind: "SB",
        bigBlind: "BB"
      },
      players: new Map([
        ["BTN", { stack: 100, holeCards: createHand("Ah", "Kd") }],
        ["SB", { stack: 80 }],
        ["BB", { stack: 120 }]
      ]),
      communityCards: createHand("Qs", "Jh"),
      pot: 10,
      street: "flop",
      actionHistory: [
        { type: "call", position: "SB", street: "preflop", amount: 1 },
        { type: "raise", position: "BTN", street: "preflop", amount: 6 }
      ],
      legalActions: [
        { type: "fold", position: "BTN", street: "flop" },
        { type: "call", position: "BTN", street: "flop", amount: 5 }
      ],
      confidence: {
        overall: 0.99,
        perElement: new Map([
          ["players", 0.995],
          ["board", 0.99]
        ])
      },
      latency: 50
    };

    const serialized = serializeGameState(state);
    const result = deserializeGameState(serialized);

    expect(result.handId).toBe(state.handId);
    expect(result.positions).toEqual(state.positions);
    expect(result.players.get("BTN")?.stack).toBe(100);
    expect(result.players.get("BTN")?.holeCards).toEqual(createHand("Ah", "Kd"));
    expect(result.communityCards).toEqual(createHand("Qs", "Jh"));
    expect(result.legalActions.length).toBe(2);
    expect(result.confidence.perElement.get("players")).toBeCloseTo(0.995);
  });
});

function createHand(...cards: string[]): Card[] {
  return cards.map(card => ({
    rank: card[0] as Card["rank"],
    suit: card[1] as Card["suit"]
  }));
}
