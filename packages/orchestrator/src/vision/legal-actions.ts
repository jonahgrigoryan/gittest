import type { GameState, Action, Position } from '@poker-bot/shared/src/types';

export function computeLegalActions(state: GameState): Action[] {
  const actions: Action[] = [];
  const heroPos = state.positions.hero;

  if (canFold(state)) {
    actions.push({ type: 'fold', position: heroPos, street: state.street });
  }

  if (canCheck(state)) {
    actions.push({ type: 'check', position: heroPos, street: state.street });
  }

  if (canCall(state)) {
    actions.push({ type: 'call', position: heroPos, street: state.street });
  }

  const raiseInfo = canRaise(state);
  if (raiseInfo.legal) {
    actions.push({
      type: 'raise',
      position: heroPos,
      street: state.street,
      amount: raiseInfo.minRaise,
    });
  }

  return actions;
}

export function canFold(state: GameState): boolean {
  // Always can fold if facing a bet
  return true;
}

export function canCheck(state: GameState): boolean {
  // Can check if no bet to call
  // Simplified: check if last action was check or no action
  const lastAction = state.actionHistory[state.actionHistory.length - 1];
  return !lastAction || lastAction.type === 'check';
}

export function canCall(state: GameState): boolean {
  // Can call if facing a bet and have chips
  const heroPlayer = state.players.get(state.positions.hero);
  if (!heroPlayer) return false;

  const lastAction = state.actionHistory[state.actionHistory.length - 1];
  return lastAction !== undefined && lastAction.type !== 'check' && heroPlayer.stack > 0;
}

export function canRaise(state: GameState): { legal: boolean; minRaise: number; maxRaise: number } {
  const heroPlayer = state.players.get(state.positions.hero);
  if (!heroPlayer) {
    return { legal: false, minRaise: 0, maxRaise: 0 };
  }

  const bigBlind = state.blinds.big;
  const minRaise = bigBlind * 2;
  const maxRaise = heroPlayer.stack;

  return {
    legal: heroPlayer.stack >= minRaise,
    minRaise,
    maxRaise,
  };
}
