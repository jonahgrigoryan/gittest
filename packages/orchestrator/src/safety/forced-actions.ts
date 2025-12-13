import type { Action, GameState, Position } from "@poker-bot/shared";

import { getCallAmount } from "../vision/legal-actions";

export function detectForcedAction(state: GameState, position: Position): Action | null {
  if (isForcedBlind(state, position)) {
    const amount = position === "SB" ? state.blinds.small : state.blinds.big;
    if (!amount || amount <= 0) {
      return null;
    }
    return {
      type: "call",
      amount,
      position,
      street: state.street
    };
  }

  if (isForcedAllIn(state, position)) {
    const player = state.players.get(position);
    return {
      type: "call",
      amount: player?.stack ?? 0,
      position,
      street: state.street
    };
  }

  return null;
}

export function isForcedBlind(state: GameState, position: Position): boolean {
  if (state.street !== "preflop") {
    return false;
  }

  if (position !== "SB" && position !== "BB") {
    return false;
  }

  const blindAmount = position === "SB" ? state.blinds.small : state.blinds.big;
  if (!blindAmount || blindAmount <= 0) {
    return false;
  }

  const hasPosted = state.actionHistory.some(action => action.position === position && action.type !== "fold");
  return !hasPosted;
}

export function isForcedAllIn(state: GameState, heroPosition: Position): boolean {
  const hero = state.players.get(heroPosition);
  if (!hero) {
    return false;
  }

  const amountToCall = getCallAmount(state);
  return amountToCall > 0 && hero.stack <= amountToCall;
}
