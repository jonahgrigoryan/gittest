import { describe, it, expect } from 'vitest';
import { GameStateParser } from '../../src/vision/parser';
import { ParserConfig } from '../../../shared/src/vision/parser-types';

describe('Confidence Scoring', () => {
  const parserConfig: ParserConfig = {
    confidenceThreshold: 0.995,
    occlusionThreshold: 0.05,
    enableInference: true
  };

  const parser = new GameStateParser(parserConfig);

  it('calculates per-element confidence correctly', () => {
    const visionOutput = {
      timestamp: Date.now(),
      cards: { holeCards: [], communityCards: [], confidence: 0.9 },
      stacks: new Map([['HERO', { amount: 1000, confidence: 0.85 }]]),
      pot: { amount: 100, confidence: 0.8 },
      buttons: { dealer: 'BTN', confidence: 0.95 },
      positions: { confidence: 0.9 },
      occlusion: new Map(),
      latency: { capture: 10, extraction: 20, total: 30 }
    };

    const result = parser.parse(visionOutput);

    expect(result.confidence.perElement.get('cards')).toBe(0.9);
    expect(result.confidence.perElement.get('pot')).toBe(0.8);
    expect(result.confidence.perElement.get('buttons')).toBe(0.95);
    expect(result.confidence.overall).toBeGreaterThan(0);
  });

  it('triggers SafeAction when overall confidence < 0.995', () => {
    const visionOutput = {
      timestamp: Date.now(),
      cards: { holeCards: [], communityCards: [], confidence: 0.99 },
      stacks: new Map(),
      pot: { amount: 100, confidence: 0.99 },
      buttons: { dealer: 'BTN', confidence: 0.99 },
      positions: { confidence: 0.99 },
      occlusion: new Map(),
      latency: { capture: 10, extraction: 20, total: 30 }
    };

    const result = parser.parseWithSafety(visionOutput, parserConfig);

    // With confidence around 0.99, should trigger SafeAction
    expect(result.safeActionTriggered).toBe(true);
  });

  it('does not trigger SafeAction when confidence = 0.995', () => {
    const visionOutput = {
      timestamp: Date.now(),
      cards: { holeCards: [], communityCards: [], confidence: 0.995 },
      stacks: new Map(),
      pot: { amount: 100, confidence: 0.995 },
      buttons: { dealer: 'BTN', confidence: 0.995 },
      positions: { confidence: 0.995 },
      occlusion: new Map(),
      latency: { capture: 10, extraction: 20, total: 30 }
    };

    const result = parser.parseWithSafety(visionOutput, {
      ...parserConfig,
      confidenceThreshold: 0.995
    });

    expect(result.safeActionTriggered).toBe(false);
  });
});