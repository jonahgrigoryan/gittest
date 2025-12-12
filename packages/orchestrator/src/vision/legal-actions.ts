import type { Action, GameState, Position } from "@poker-bot/shared/src/types";

function getHero(state: GameState) {
  const heroPosition = state.positions.hero;
  const heroInfo = state.players.get(heroPosition);
  return { heroPosition, heroInfo };
}

function getLastAggressiveAction(state: GameState): Action | undefined {
  for (let i = state.actionHistory.length - 1; i >= 0; i -= 1) {
    const action = state.actionHistory[i];
    if (action.type === "raise" || action.type === "call") {
      return action;
    }
  }
  return undefined;
}

function getHeroContribution(state: GameState, position: Position): number {
  let contribution = 0;
  for (const action of state.actionHistory) {
    if (action.position !== position) {
      continue;
    }
    if (action.type === "call" || action.type === "raise") {
      contribution = action.amount ?? contribution;
    }
  }
  return contribution;
}

export function getCallAmount(state: GameState): number {
  const lastAggressive = getLastAggressiveAction(state);
  if (!lastAggressive || lastAggressive.amount === undefined) {
    return 0;
  }

  const { heroPosition } = getHero(state);
  const contribution = getHeroContribution(state, heroPosition);
  return Math.max(0, lastAggressive.amount - contribution);
}

export function canFold(state: GameState): boolean {
  return getCallAmount(state) > 0;
}

export function canCheck(state: GameState): boolean {
  return getCallAmount(state) === 0;
}

export function canCall(state: GameState): boolean {
  const { heroInfo } = getHero(state);
  if (!heroInfo) {
    return false;
  }

  const amount = getCallAmount(state);
  return amount > 0 && heroInfo.stack >= amount;
}

export function canRaise(state: GameState): { legal: boolean; minRaise: number; maxRaise: number } {
  const { heroInfo, heroPosition } = getHero(state);
  if (!heroInfo) {
    return { legal: false, minRaise: 0, maxRaise: 0 };
  }

  const amountToCall = getCallAmount(state);
  const minRaise = Math.max(state.blinds.big, amountToCall * 2 || state.blinds.big);
  const contribution = getHeroContribution(state, heroPosition);
  const maxRaise = heroInfo.stack + contribution;
  const legal = heroInfo.stack > amountToCall && maxRaise > minRaise;

  return {
    legal,
    minRaise,
    maxRaise
  };
}

export function computeLegalActions(state: GameState): Action[] {
  const actions: Action[] = [];
  const heroPosition = state.positions.hero;

  if (canFold(state)) {
    actions.push({ type: "fold", position: heroPosition, street: state.street });
  }

  if (canCheck(state)) {
    actions.push({ type: "check", position: heroPosition, street: state.street });
  }

  if (canCall(state)) {
    actions.push({
      type: "call",
      amount: getCallAmount(state),
      position: heroPosition,
      street: state.street
    });
  }

  const raiseInfo = canRaise(state);
  if (raiseInfo.legal) {
    actions.push({
      type: "raise",
      amount: raiseInfo.minRaise,
      position: heroPosition,
      street: state.street
    });
  }

  return actions;
}
