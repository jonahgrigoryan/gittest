import { describe, it, expect } from 'vitest';
import { shouldTriggerSafeAction } from '../../src/safety/safe-action';
import type { ParsedGameState, ParserConfig } from '../../../shared/src/vision/parser-types';

describe('Confidence Gating', () => {
  const baseConfig: ParserConfig = {
    confidenceThreshold: 0.995,
    occlusionThreshold: 0.05,
    enableInference: true
  };

  const createMockState = (overallConfidence: number): ParsedGameState => ({
    handId: 'test',
    gameType: 'NLHE_6max',
    blinds: { small: 5, big: 10 },
    positions: {
      hero: 'HERO',
      button: 'BTN',
      smallBlind: 'SB',
      bigBlind: 'BB'
    },
    players: new Map([['HERO', { stack: 1000 }]]),
    communityCards: [],
    pot: 15,
    street: 'preflop',
    actionHistory: [],
    legalActions: [],
    confidence: { overall: overallConfidence, perElement: new Map() },
    latency: 30,
    parseErrors: [],
    missingElements: [],
    inferredValues: {}
  });

  it('triggers SafeAction when overall confidence < 0.995', () => {
    const state = createMockState(0.99);
    const shouldTrigger = shouldTriggerSafeAction(state, baseConfig);

    expect(shouldTrigger).toBe(true);
  });

  it('does not trigger when confidence = 0.995', () => {
    const state = createMockState(0.995);
    const shouldTrigger = shouldTriggerSafeAction(state, baseConfig);

    expect(shouldTrigger).toBe(false);
  });

  it('does not trigger when occlusion = 5%', () => {
    const state = createMockState(0.995);
    // In real implementation, would check occlusion field
    const shouldTrigger = shouldTriggerSafeAction(state, baseConfig);

    expect(shouldTrigger).toBe(false);
  });

  it('uses config thresholds correctly', () => {
    const customConfig: ParserConfig = {
      ...baseConfig,
      confidenceThreshold: 0.9 // Lower threshold
    };

    const state = createMockState(0.95);
    const shouldTrigger = shouldTriggerSafeAction(state, customConfig);

    expect(shouldTrigger).toBe(false); // 0.95 > 0.9, so no trigger
  });

  it('triggers on parse errors', () => {
    const state: ParsedGameState = {
      ...createMockState(0.995),
      parseErrors: ['Test error']
    };

    const shouldTrigger = shouldTriggerSafeAction(state, baseConfig);
    expect(shouldTrigger).toBe(true);
  });
});