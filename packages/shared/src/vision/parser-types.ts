import type { Action, GameState } from "../types";

export interface ParsedGameState extends GameState {
  parseErrors: string[];
  missingElements: string[];
  inferredValues: Record<string, unknown>;
  recommendedAction?: Action;
  safeActionTriggered?: boolean;
}

export interface ParserConfig {
  confidenceThreshold: number;
  occlusionThreshold: number;
  enableInference: boolean;
}
