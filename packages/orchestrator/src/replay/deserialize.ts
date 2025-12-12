import type { Card, GameState, Position } from "@poker-bot/shared/src/types";
import type { SerializedGameState } from "@poker-bot/shared/src/strategy";

export function deserializeGameState(serialized: SerializedGameState): GameState {
  const players = new Map<Position, { stack: number; holeCards?: Card[] }>();
  if (serialized.players && Array.isArray(serialized.players)) {
    for (const player of serialized.players) {
      players.set(player.position, {
        stack: player.stack,
        holeCards: player.holeCards
      });
    }
  }

  const perElement = new Map<string, number>();
  if (serialized.confidence?.perElement) {
    for (const [key, value] of Object.entries(serialized.confidence.perElement)) {
      perElement.set(key, value);
    }
  }

  return {
    handId: serialized.handId,
    gameType: serialized.gameType ?? "NLHE_6max",
    blinds: serialized.blinds ?? { small: 1, big: 2 },
    positions: serialized.positions ?? {
      hero: "BTN",
      button: "BTN",
      smallBlind: "SB",
      bigBlind: "BB"
    },
    players,
    communityCards: serialized.communityCards ?? [],
    pot: typeof serialized.pot === "number" ? serialized.pot : 0,
    street: serialized.street ?? "preflop",
    actionHistory: serialized.actionHistory ?? [],
    legalActions:
      serialized.legalActions ??
      [
        { type: "check", position: (serialized.positions?.hero ?? "BTN") as Position, street: serialized.street ?? "preflop" }
      ],
    confidence: {
      overall: serialized.confidence?.overall ?? 1,
      perElement
    },
    latency: typeof serialized.latency === "number" ? serialized.latency : 0
  };
}
