import type { GameState, Action, Position } from '../../../shared/src/types';

export function detectForcedAction(state: GameState, position: Position): Action | null {
  // Check for forced blind posting
  const forcedBlind = isForcedBlind(state, position);
  if (forcedBlind) {
    return {
      type: 'call', // Blinds are posted as calls
      amount: position === state.positions.smallBlind ? state.blinds.small : state.blinds.big,
      position,
      street: 'preflop'
    };
  }

  // Check for forced all-in
  if (isForcedAllIn(state, position)) {
    const player = state.players.get(position);
    const stack = player ? player.stack : 0;

    return {
      type: 'raise', // All-in is a raise to stack amount
      amount: stack,
      position,
      street: state.street
    };
  }

  return null; // No forced action
}

export function isForcedBlind(state: GameState, position: Position): boolean {
  // Check if position is SB or BB
  const isBlindPosition = position === state.positions.smallBlind || position === state.positions.bigBlind;

  if (!isBlindPosition) {
    return false;
  }

  // Check if blind hasn't been posted yet this hand
  // This is a simplification - in real poker, would track posted blinds
  const actionHistory = state.actionHistory;

  // For now, assume blinds need to be posted if no actions yet
  return actionHistory.length === 0;
}

export function isForcedAllIn(state: GameState, heroPosition: Position): boolean {
  const player = state.players.get(heroPosition);

  if (!player) {
    return false;
  }

  const stack = player.stack;
  const currentBet = getCurrentBetToCall(state);

  // Forced all-in if stack <= bet to call
  return stack <= currentBet;
}

function getCurrentBetToCall(state: GameState): number {
  // Placeholder - would analyze action history to find current bet
  // For now, return 0 (no bet)
  return 0;
}