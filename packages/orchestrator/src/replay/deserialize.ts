import type {
  GameState,
  Position,
  SerializedGameState,
  Card,
  Action
} from "@poker-bot/shared";

export function deserializeGameState(serialized: SerializedGameState): GameState {
  const players = new Map<Position, { stack: number; holeCards?: Card[] }>();
  for (const player of serialized.players) {
    players.set(player.position, {
      stack: player.stack,
      holeCards: player.holeCards
    });
  }

  const perElementEntries = Object.entries(serialized.confidence.perElement ?? {});
  const perElement = new Map<string, number>();
  for (const [key, value] of perElementEntries) {
    perElement.set(key, value);
  }

  return {
    handId: serialized.handId,
    gameType: serialized.gameType,
    blinds: serialized.blinds,
    positions: serialized.positions,
    players,
    communityCards: serialized.communityCards,
    pot: serialized.pot,
    street: serialized.street,
    actionHistory: serialized.actionHistory as Action[],
    legalActions: serialized.legalActions as Action[],
    confidence: {
      overall: serialized.confidence.overall,
      perElement
    },
    latency: serialized.latency
  };
}
