import type {
  GameState,
  Position,
  SerializedGameState,
  Card,
  Action
} from "@poker-bot/shared";

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
    positions: serialized.positions ?? { hero: "BTN", dealer: "BTN" },
    players,
    communityCards: serialized.communityCards ?? [],
    pot: serialized.pot ?? { amount: 0 },
    street: serialized.street,
    actionHistory: (serialized.actionHistory ?? []) as Action[],
    legalActions: (serialized.legalActions ?? [{ type: "check", position: "BTN", street: serialized.street }]) as Action[],
    confidence: {
      overall: serialized.confidence?.overall ?? 1,
      perElement
    },
    latency: serialized.latency ?? { captureMs: 0, parseMs: 0, totalMs: 0 }
  };
}
