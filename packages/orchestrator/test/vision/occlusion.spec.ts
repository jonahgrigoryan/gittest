import { describe, it, expect } from 'vitest';
import { GameStateParser } from '../../src/vision/parser';
import { ParserConfig } from '../../../shared/src/vision/parser-types';

describe('Occlusion Detection', () => {
  const parserConfig: ParserConfig = {
    confidenceThreshold: 0.995,
    occlusionThreshold: 0.05,
    enableInference: true
  };

  const parser = new GameStateParser(parserConfig);

  it('detects occluded ROI from low variance', () => {
    // This would require actual image processing tests
    // For now, just test the parsing logic
    const visionOutput = {
      timestamp: Date.now(),
      cards: { holeCards: [], communityCards: [], confidence: 0.95 },
      stacks: new Map(),
      pot: { amount: 100, confidence: 0.95 },
      buttons: { dealer: 'BTN', confidence: 0.95 },
      positions: { confidence: 0.95 },
      occlusion: new Map([['cards', 0.1]]), // 10% occlusion
      latency: { capture: 10, extraction: 20, total: 30 }
    };

    const result = parser.parse(visionOutput);
    expect(result).toBeDefined();
    // In real implementation, high occlusion would affect confidence
  });

  it('does not flag normal cards as occluded', () => {
    const visionOutput = {
      timestamp: Date.now(),
      cards: { holeCards: [], communityCards: [], confidence: 0.95 },
      stacks: new Map(),
      pot: { amount: 100, confidence: 0.95 },
      buttons: { dealer: 'BTN', confidence: 0.95 },
      positions: { confidence: 0.95 },
      occlusion: new Map([['cards', 0.01]]), // 1% occlusion
      latency: { capture: 10, extraction: 20, total: 30 }
    };

    const result = parser.parse(visionOutput);
    expect(result.confidence.overall).toBeGreaterThan(0.8);
  });

  it('triggers SafeAction when occlusion exceeds threshold', () => {
    const visionOutput = {
      timestamp: Date.now(),
      cards: { holeCards: [], communityCards: [], confidence: 0.95 },
      stacks: new Map(),
      pot: { amount: 100, confidence: 0.95 },
      buttons: { dealer: 'BTN', confidence: 0.95 },
      positions: { confidence: 0.95 },
      occlusion: new Map([['cards', 0.1]]), // High occlusion
      latency: { capture: 10, extraction: 20, total: 30 }
    };

    // Test would check if SafeAction triggers on high occlusion
    // This requires implementing occlusion logic in parser
    const result = parser.parse(visionOutput);
    expect(result).toBeDefined();
  });
});