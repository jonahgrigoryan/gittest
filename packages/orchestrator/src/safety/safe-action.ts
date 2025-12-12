import type { BotConfig } from "@poker-bot/shared/src/config/types";
import type { Action, Position } from "@poker-bot/shared/src/types";
import type { ParsedGameState } from "@poker-bot/shared/src/vision";

const DEFAULT_CONFIDENCE_THRESHOLD = 0.9;
const DEFAULT_OCCLUSION_THRESHOLD = 0.05;

export function shouldTriggerSafeAction(state: ParsedGameState, botConfig: BotConfig): boolean {
  const confidenceThreshold = botConfig.vision?.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const occlusionThreshold = botConfig.vision?.occlusionThreshold ?? DEFAULT_OCCLUSION_THRESHOLD;

  if (state.confidence.overall < confidenceThreshold) {
    return true;
  }

  const occlusion = (state.inferredValues.occlusion as Record<string, number> | undefined) ?? {};
  const occlusionExceeded = Object.values(occlusion).some(value => value > occlusionThreshold);
  if (occlusionExceeded) {
    return true;
  }

  if (state.parseErrors.length > 0) {
    return true;
  }

  return false;
}

export function selectSafeAction(state: ParsedGameState): Action {
  const heroPosition = state.positions.hero;
  const preferred = findAction(state, heroPosition, "check") ?? findAction(state, heroPosition, "fold");
  if (preferred) {
    return preferred;
  }

  return {
    type: "fold",
    position: heroPosition,
    street: state.street
  };
}

function findAction(state: ParsedGameState, position: Position, type: Action["type"]): Action | undefined {
  return state.legalActions.find(action => action.position === position && action.type === type);
}
