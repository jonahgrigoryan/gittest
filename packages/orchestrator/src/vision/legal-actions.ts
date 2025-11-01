import type { GameState, Action, Position } from '../../../shared/src/types';

export function computeLegalActions(state: GameState): Action[] {
  const actions: Action[] = [];
  const hero = state.players.get(state.positions.hero);

  if (!hero) {
    return actions; // No hero player, no actions
  }

  const heroStack = hero.stack;
  const currentBet = getCurrentBetToCall(state);
  const minRaise = getMinRaise(state);
  const maxRaise = Math.min(heroStack, getMaxRaise(state));

  // Always add fold
  actions.push({
    type: 'fold',
    position: state.positions.hero,
    street: state.street
  });

  // Check if check is legal (no bet to call)
  if (canCheck(state)) {
    actions.push({
      type: 'check',
      position: state.positions.hero,
      street: state.street
    });
  }

  // Check if call is legal
  if (canCall(state, heroStack, currentBet)) {
    actions.push({
      type: 'call',
      amount: currentBet,
      position: state.positions.hero,
      street: state.street
    });
  }

  // Check if raise is legal
  const raisePossible = canRaise(state, heroStack, minRaise, maxRaise);
  if (raisePossible.legal) {
    actions.push({
      type: 'raise',
      amount: raisePossible.minRaise,
      position: state.positions.hero,
      street: state.street
    });

    // Add max raise as separate option if different
    if (raisePossible.maxRaise > raisePossible.minRaise) {
      actions.push({
        type: 'raise',
        amount: raisePossible.maxRaise,
        position: state.positions.hero,
        street: state.street
      });
    }
  }

  return actions;
}

export function canFold(state: GameState): boolean {
  // Fold is always legal when facing action
  return true;
}

export function canCheck(state: GameState): boolean {
  // Check is legal if no bet to call
  const currentBet = getCurrentBetToCall(state);
  return currentBet === 0;
}

export function canCall(state: GameState, heroStack: number, currentBet: number): boolean {
  // Call is legal if there's a bet and hero has enough stack
  return currentBet > 0 && heroStack >= currentBet;
}

export function canRaise(
  state: GameState,
  heroStack: number,
  minRaise: number,
  maxRaise: number
): { legal: boolean; minRaise: number; maxRaise: number } {

  // Raise is legal if hero has enough stack for min raise
  const legal = heroStack >= minRaise && maxRaise >= minRaise;

  return {
    legal,
    minRaise,
    maxRaise
  };
}

function getCurrentBetToCall(state: GameState): number {
  // Find the highest bet on this street
  // Placeholder - would need to analyze action history
  return 0; // Assume no bet for now
}

function getMinRaise(state: GameState): number {
  // Calculate minimum raise amount
  const bigBlind = state.blinds.big;
  const lastBet = getCurrentBetToCall(state);

  // Min raise is typically last bet + 1 big blind, or 2x last bet
  return Math.max(lastBet + bigBlind, lastBet * 2);
}

function getMaxRaise(state: GameState): number {
  // Max raise is typically all-in
  // But could be limited by table rules
  const hero = state.players.get(state.positions.hero);
  return hero ? hero.stack : 0;
}