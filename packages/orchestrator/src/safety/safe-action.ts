import type { ParsedGameState, ParserConfig } from '../../../shared/src/vision/parser-types';
import type { Action } from '../../../shared/src/types';

export function shouldTriggerSafeAction(state: ParsedGameState, config: ParserConfig): boolean {
  const overallConfidence = state.confidence.overall;
  const confidenceThreshold = config.confidenceThreshold || 0.995;
  const occlusionThreshold = config.occlusionThreshold || 0.05;

  // Check overall confidence threshold
  if (overallConfidence < confidenceThreshold) {
    return true;
  }

  // Check for high occlusion (placeholder - would need occlusion data)
  // const maxOcclusion = Math.max(...state.occlusion.values());
  // if (maxOcclusion > occlusionThreshold) {
  //   return true;
  // }

  // Check for parse errors
  if (state.parseErrors.length > 0) {
    return true;
  }

  return false;
}

export function selectSafeAction(state: ParsedGameState): Action {
  const heroPosition = state.positions.hero;
  const street = state.street;

  // Safe actions: prefer check, fallback to fold, never raise

  // Check if check is legal (no bet facing)
  const legalActions = state.legalActions;
  const checkAction = legalActions.find(a => a.type === 'check');

  if (checkAction) {
    return checkAction;
  }

  // Fallback to fold
  const foldAction = legalActions.find(a => a.type === 'fold');
  if (foldAction) {
    return foldAction;
  }

  // Ultimate fallback - create fold action
  return {
    type: 'fold',
    position: heroPosition,
    street: street
  };
}