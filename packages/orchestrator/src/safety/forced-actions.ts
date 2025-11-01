import type { GameState, Action, Position } from "@poker-bot/shared";

/**
 * Detect if a forced action is required (blinds, all-in situations)
 */
export function detectForcedAction(
  state: GameState,
  position: Position
): Action | null {
  // Check for forced blind posting
  if (isForcedBlind(state, position)) {
    const amount =
      position === "SB" ? state.blinds.small : state.blinds.big;
    return {
      type: "raise",
      amount,
      position,
      street: state.street,
    };
  }

  // Check for forced all-in
  if (isForcedAllIn(state, position)) {
    const playerData = state.players.get(position);
    if (playerData) {
      return {
        type: "raise",
        amount: playerData.stack,
        position,
        street: state.street,
      };
    }
  }

  return null;
}

/**
 * Check if position must post blind
 */
export function isForcedBlind(state: GameState, position: Position): boolean {
  // Check if this is a blind position
  if (position !== "SB" && position !== "BB") {
    return false;
  }

  // Check if preflop and no actions yet
  if (state.street !== "preflop") {
    return false;
  }

  // Check if blinds not yet posted (action history is empty)
  return state.actionHistory.length === 0;
}

/**
 * Check if all-in is the only legal action
 */
export function isForcedAllIn(
  state: GameState,
  heroPosition: Position
): boolean {
  const heroData = state.players.get(heroPosition);
  if (!heroData) return false;

  // If stack is less than minimum bet, only all-in is legal
  const minBet = state.blinds.big;
  return heroData.stack < minBet && heroData.stack > 0;
}
