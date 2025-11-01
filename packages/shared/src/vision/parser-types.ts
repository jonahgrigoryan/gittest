import type { GameState, Action } from '../types';

export interface ParsedGameState extends GameState {
  parseErrors: string[];
  missingElements: string[];
  inferredValues: Record<string, any>;
  recommendedAction?: Action;
  safeActionTriggered?: boolean;
}

export interface ParserConfig {
  confidenceThreshold: number;
  occlusionThreshold: number;
  enableInference: boolean;
}