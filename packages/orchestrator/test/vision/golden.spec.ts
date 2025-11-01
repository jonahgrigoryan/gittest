import { describe, it, expect } from 'vitest';
import { GameStateParser } from '../../src/vision/parser';
import { ParserConfig } from '../../../shared/src/vision/parser-types';
import fs from 'fs';
import path from 'path';

describe('Vision Golden Tests', () => {
  const parserConfig: ParserConfig = {
    confidenceThreshold: 0.995,
    occlusionThreshold: 0.05,
    enableInference: true
  };

  const parser = new GameStateParser(parserConfig);

  // Mock vision output for testing
  const mockVisionOutput = {
    timestamp: Date.now(),
    cards: {
      holeCards: [
        { rank: 'A', suit: 's' },
        { rank: 'K', suit: 'h' }
      ],
      communityCards: [],
      confidence: 0.95
    },
    stacks: new Map([
      ['HERO', { amount: 1000, confidence: 0.9 }],
      ['BTN', { amount: 500, confidence: 0.85 }],
      ['SB', { amount: 200, confidence: 0.88 }],
      ['BB', { amount: 800, confidence: 0.87 }]
    ]),
    pot: { amount: 15, confidence: 0.88 },
    buttons: { dealer: 'BTN', confidence: 0.92 },
    positions: { confidence: 0.9 },
    occlusion: new Map(),
    latency: {
      capture: 10,
      extraction: 20,
      total: 30
    }
  };

  it('parses clean preflop state correctly', () => {
    const result = parser.parse(mockVisionOutput);

    expect(result.gameType).toBe('NLHE_6max');
    expect(result.street).toBe('preflop');
    expect(result.communityCards).toHaveLength(0);
    expect(result.players.get('HERO')?.stack).toBe(1000);
    expect(result.pot).toBe(15);
    expect(result.confidence.overall).toBeGreaterThan(0.8);
    expect(result.parseErrors).toHaveLength(0);
  });

  it('handles low confidence gracefully', () => {
    const lowConfidenceOutput = {
      ...mockVisionOutput,
      cards: { ...mockVisionOutput.cards, confidence: 0.3 }
    };

    const result = parser.parse(lowConfidenceOutput);
    expect(result.confidence.overall).toBeLessThan(0.5);
    expect(result.parseErrors).toHaveLength(0); // Should not error, just low confidence
  });

  it('infers positions correctly', () => {
    const result = parser.parse(mockVisionOutput);

    expect(result.positions.hero).toBeDefined();
    expect(result.positions.button).toBe('BTN');
    expect(result.positions.smallBlind).toBeDefined();
    expect(result.positions.bigBlind).toBeDefined();
  });

  it('calculates legal actions correctly', () => {
    const result = parser.parse(mockVisionOutput);

    expect(result.legalActions.length).toBeGreaterThan(0);
    expect(result.legalActions.some(a => a.type === 'fold')).toBe(true);

    // Should have call or check available
    const hasCallOrCheck = result.legalActions.some(a =>
      a.type === 'call' || a.type === 'check'
    );
    expect(hasCallOrCheck).toBe(true);
  });

  it('triggers SafeAction when confidence below threshold', () => {
    const result = parser.parseWithSafety(mockVisionOutput, {
      ...parserConfig,
      confidenceThreshold: 0.99 // Above current confidence
    });

    expect(result.safeActionTriggered).toBe(true);
    expect(result.recommendedAction).toBeDefined();
    expect(result.recommendedAction!.type).toBe('fold'); // Safe action
  });

  it('does not trigger SafeAction when confidence above threshold', () => {
    const result = parser.parseWithSafety(mockVisionOutput, {
      ...parserConfig,
      confidenceThreshold: 0.8 // Below current confidence
    });

    expect(result.safeActionTriggered).toBe(false);
  });
});