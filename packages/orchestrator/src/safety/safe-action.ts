import type { Action, Position, Street } from '@poker-bot/shared/src/types';
import type { ParsedGameState } from './parser-types';
import type { BotConfig } from '@poker-bot/shared/src/config/types';

export function shouldTriggerSafeAction(state: ParsedGameState, config: BotConfig): boolean {
  const confThreshold = config.vision.confidenceThreshold;
  const occThreshold = config.vision.occlusionThreshold;

  // Check overall confidence
  if (state.confidence.overall < confThreshold) {
    return true;
  }

  // Check for parse errors
  if (state.parseErrors.length > 0) {
    return true;
  }

  // Check for missing critical elements
  if (state.missingElements.length > 0) {
    return true;
  }

  // Check occlusion (would need access to visionOutput)
  // For now, rely on confidence and errors

  return false;
}

export function selectSafeAction(state: ParsedGameState): Action {
  const street = state.street;
  const heroPos = state.positions.hero;

  // Check if check is legal
  const canCheck = state.legalActions.some(a => a.type === 'check');

  if (canCheck) {
    return { type: 'check', position: heroPos, street };
  }

  // Otherwise fold
  return { type: 'fold', position: heroPos, street };
}
