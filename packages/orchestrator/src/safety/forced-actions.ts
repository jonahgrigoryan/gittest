import type { GameState, Action, Position } from '@poker-bot/shared/src/types';

export function detectForcedAction(state: GameState, position: Position): Action | null {
  if (isForcedBlind(state, position)) {
    const blindAmount = position === 'SB' ? state.blinds.small : state.blinds.big;
    return {
      type: 'call',
      position,
      street: state.street,
      amount: blindAmount,
    };
  }

  if (isForcedAllIn(state, position)) {
    const heroPlayer = state.players.get(position);
    if (heroPlayer) {
      return {
        type: 'raise',
        position,
        street: state.street,
        amount: heroPlayer.stack,
      };
    }
  }

  return null;
}

export function isForcedBlind(state: GameState, position: Position): boolean {
  // Check if position is SB or BB
  if (position !== 'SB' && position !== 'BB') {
    return false;
  }

  // Check if blind not yet posted this hand
  // Simplified: always return true if in blind position
  // In real implementation, would check action history
  return position === state.positions.smallBlind || position === state.positions.bigBlind;
}

export function isForcedAllIn(state: GameState, heroPosition: Position): boolean {
  const heroPlayer = state.players.get(heroPosition);
  if (!heroPlayer) return false;

  const bigBlind = state.blinds.big;
  return heroPlayer.stack < bigBlind * 2;
}
