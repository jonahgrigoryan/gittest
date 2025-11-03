import type { GameState } from "@poker-bot/shared";

export type ActionSizing = number | "all-in";

export interface ActionSetOptions {
  standard?: ActionSizing[];
  deep?: ActionSizing[];
}

export const STANDARD_ACTION_SET: ActionSizing[] = [0.33, 0.5, 0.75, 1.0, "all-in"];
export const DEEP_STACK_ACTION_SET: ActionSizing[] = [0.25, 0.33, 0.5, 0.67, 0.75, 1.0, 1.25, 1.5, 2.0, "all-in"];

export function calculateEffectiveStack(state: GameState): number {
  const heroPosition = state.positions.hero;
  const hero = state.players.get(heroPosition);
  if (!hero) {
    return 0;
  }
  const heroStack = hero.stack;
  const opponentStacks = Array.from(state.players.entries())
    .filter(([position]) => position !== heroPosition)
    .map(([, player]) => player.stack)
    .filter((stack) => stack > 0 && Number.isFinite(stack));

  if (opponentStacks.length === 0) {
    const divisor = Math.max(state.blinds.big, 1);
    return Number((heroStack / divisor).toFixed(2));
  }

  const minOpponentStack = Math.min(...opponentStacks);
  const effectiveStack = Math.min(heroStack, minOpponentStack);
  const bigBlind = Math.max(state.blinds.big, 1);
  return Number((effectiveStack / bigBlind).toFixed(2));
}

export function selectActionSet(
  effectiveStackBb: number,
  thresholdBb: number,
  options: ActionSetOptions = {},
): ActionSizing[] {
  const standard = options.standard ?? STANDARD_ACTION_SET;
  const deep = options.deep ?? DEEP_STACK_ACTION_SET;
  return effectiveStackBb > thresholdBb ? deep : standard;
}

export function actionSetToStrings(actionSet: ActionSizing[]): string[] {
  return actionSet.map((value) => (typeof value === "number" ? value.toString() : value));
}
