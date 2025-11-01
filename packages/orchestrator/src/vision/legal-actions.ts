import type { GameState, Action, Position } from "@poker-bot/shared";

/**
 * Compute legal actions for current game state
 */
export function computeLegalActions(state: GameState): Action[] {
  const actions: Action[] = [];
  const heroPos = state.positions.hero;

  // Always can fold if facing a bet
  if (canFold(state)) {
    actions.push({
      type: "fold",
      position: heroPos,
      street: state.street,
    });
  }

  // Can check if no bet to call
  if (canCheck(state)) {
    actions.push({
      type: "check",
      position: heroPos,
      street: state.street,
    });
  }

  // Can call if facing a bet
  if (canCall(state)) {
    const callAmount = getCallAmount(state);
    actions.push({
      type: "call",
      amount: callAmount,
      position: heroPos,
      street: state.street,
    });
  }

  // Can raise if allowed
  const raiseInfo = canRaise(state);
  if (raiseInfo.legal) {
    actions.push({
      type: "raise",
      amount: raiseInfo.minRaise,
      position: heroPos,
      street: state.street,
    });
  }

  return actions;
}

/**
 * Check if fold is legal
 */
export function canFold(state: GameState): boolean {
  // Can always fold if there's been action
  return state.actionHistory.length > 0;
}

/**
 * Check if check is legal
 */
export function canCheck(state: GameState): boolean {
  // Can check if no one has bet/raised
  const lastAction = state.actionHistory[state.actionHistory.length - 1];
  if (!lastAction) return true;

  return lastAction.type === "check" || lastAction.type === "fold";
}

/**
 * Check if call is legal
 */
export function canCall(state: GameState): boolean {
  // Can call if someone has bet/raised
  const lastAction = state.actionHistory[state.actionHistory.length - 1];
  if (!lastAction) return false;

  return lastAction.type === "raise" && (lastAction.amount ?? 0) > 0;
}

/**
 * Get amount needed to call
 */
function getCallAmount(state: GameState): number {
  const lastAction = state.actionHistory[state.actionHistory.length - 1];
  if (!lastAction || lastAction.type !== "raise") return 0;

  return lastAction.amount ?? 0;
}

/**
 * Check if raise is legal and get limits
 */
export function canRaise(
  state: GameState
): { legal: boolean; minRaise: number; maxRaise: number } {
  const heroPos = state.positions.hero;
  const heroData = state.players.get(heroPos);

  if (!heroData) {
    return { legal: false, minRaise: 0, maxRaise: 0 };
  }

  const heroStack = heroData.stack;

  // Can't raise with no chips
  if (heroStack <= 0) {
    return { legal: false, minRaise: 0, maxRaise: 0 };
  }

  // Calculate minimum raise (typically 2x big blind or 2x last raise)
  const minRaise = state.blinds.big * 2;

  // Maximum raise is hero's stack
  const maxRaise = heroStack;

  // Legal if we have chips for minimum raise
  const legal = heroStack >= minRaise;

  return { legal, minRaise, maxRaise };
}
