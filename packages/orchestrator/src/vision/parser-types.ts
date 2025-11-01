import type { GameState, Card, Position, Action, Street } from '@poker-bot/shared/src/types';
import type { VisionOutput } from '@poker-bot/shared/src/vision/types';

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
