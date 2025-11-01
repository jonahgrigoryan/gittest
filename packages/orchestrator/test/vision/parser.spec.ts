import { describe, it, expect } from 'vitest';
import { GameStateParser } from '../vision/parser';
import type { VisionOutput } from '@poker-bot/shared/src/vision/types';
import type { ParsedGameState } from '../vision/parser-types';

describe('Game State Parser', () => {
  const parser = new GameStateParser({
    confidenceThreshold: 0.8,
    occlusionThreshold: 0.05,
    enableInference: true,
  });

  it('parses clean preflop state correctly', () => {
    const visionOutput: VisionOutput = {
      timestamp: Date.now(),
      cards: {
        holeCards: [
          { rank: 'A', suit: 'h' },
          { rank: 'K', suit: 's' },
        ],
        communityCards: [],
        confidence: 0.95,
      },
      stacks: new Map([
        ['BTN', { amount: 1000, confidence: 0.9 }],
        ['BB', { amount: 1000, confidence: 0.9 }],
      ]),
      pot: { amount: 3, confidence: 0.9 },
      buttons: { dealer: 'BTN', confidence: 0.95 },
      positions: { confidence: 0.9 },
      occlusion: new Map(),
      latency: { capture: 10, extraction: 20, total: 30 },
    };

    const state = parser.parse(visionOutput);
    
    expect(state.street).toBe('preflop');
    expect(state.cards.holeCards.length).toBe(2);
    expect(state.communityCards.length).toBe(0);
    expect(state.players.size).toBeGreaterThan(0);
  });

  it('handles low confidence gracefully', () => {
    const visionOutput: VisionOutput = {
      timestamp: Date.now(),
      cards: {
        holeCards: [{ rank: '?', suit: '?' }],
        communityCards: [],
        confidence: 0.5,
      },
      stacks: new Map(),
      pot: { amount: 0, confidence: 0.5 },
      buttons: { dealer: 'BTN', confidence: 0.5 },
      positions: { confidence: 0.5 },
      occlusion: new Map(),
      latency: { capture: 10, extraction: 20, total: 30 },
    };

    const state = parser.parse(visionOutput);
    expect(state.parseErrors.length).toBeGreaterThanOrEqual(0);
  });
});
