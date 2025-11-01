import type { ParsedGameState } from "@poker-bot/shared/vision";
import type { Action, BotConfig } from "@poker-bot/shared";
import { canCheck } from "../vision/legal-actions";

/**
 * Check if SafeAction should be triggered based on confidence and occlusion
 */
export function shouldTriggerSafeAction(
  state: ParsedGameState,
  config: BotConfig
): boolean {
  // Get thresholds from config (with defaults)
  const confidenceThreshold = config.vision?.confidenceThreshold ?? 0.995;
  const occlusionThreshold = config.vision?.occlusionThreshold ?? 0.05;

  // Check overall confidence
  if (state.confidence.overall < confidenceThreshold) {
    return true;
  }

  // Check for any element occlusion above threshold
  for (const [element, occlusionPct] of state.confidence.perElement) {
    if (element.startsWith("occlusion_") && occlusionPct > occlusionThreshold) {
      return true;
    }
  }

  // Check for parse errors
  if (state.parseErrors.length > 0) {
    return true;
  }

  // Check for missing critical elements
  const criticalElements = ["cards", "pot", "stacks"];
  for (const element of criticalElements) {
    if (state.missingElements.includes(element)) {
      return true;
    }
  }

  return false;
}

/**
 * Select a safe action (conservative play)
 */
export function selectSafeAction(state: ParsedGameState): Action {
  const heroPos = state.positions.hero;

  // Preflop strategy: check if possible, else fold
  if (state.street === "preflop") {
    if (canCheck(state)) {
      return {
        type: "check",
        position: heroPos,
        street: state.street,
      };
    } else {
      return {
        type: "fold",
        position: heroPos,
        street: state.street,
      };
    }
  }

  // Postflop strategy: check if possible, else fold
  if (canCheck(state)) {
    return {
      type: "check",
      position: heroPos,
      street: state.street,
    };
  } else {
    return {
      type: "fold",
      position: heroPos,
      street: state.street,
    };
  }
}
