import type { Action, GameState, Position } from "@poker-bot/shared";
import type { DecisionRequestContext } from "../runner/harness";

interface GameStateFactoryOptions {
  bigBlind?: number;
  startingStackBb?: number;
}

export function createSimulatedGameState(
  handId: string,
  context: DecisionRequestContext,
  options: GameStateFactoryOptions = {},
): GameState {
  const bigBlind = options.bigBlind ?? context.bigBlind ?? 2;
  const smallBlind = Math.max(1, Math.floor(bigBlind / 2));
  const startingStack = (options.startingStackBb ?? 100) * bigBlind;
  const hero: Position = "BTN";
  const villain: Position = "BB";
  const blindsPot = smallBlind + bigBlind;

  return {
    handId,
    gameType: "HU_NLHE",
    blinds: { small: smallBlind, big: bigBlind },
    positions: {
      hero,
      button: hero,
      smallBlind: hero,
      bigBlind: villain,
    },
    players: new Map<Position, { stack: number }>([
      [hero, { stack: startingStack }],
      [villain, { stack: startingStack }],
    ]),
    communityCards: [],
    pot: blindsPot,
    street: "preflop",
    actionHistory: [],
    legalActions: createLegalActions(hero, bigBlind),
    confidence: {
      overall: 1,
      perElement: new Map<string, number>([
        ["state", 1],
        ["simulated", 1],
      ]),
    },
    latency: 0,
  };
}

function createLegalActions(position: Position, bigBlind: number): Action[] {
  return [
    { type: "fold", position, street: "preflop" },
    { type: "call", position, street: "preflop", amount: bigBlind },
    { type: "raise", position, street: "preflop", amount: bigBlind * 3 },
  ];
}
