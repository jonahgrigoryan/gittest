import { describe, it, expect } from 'vitest';
import { StateSyncTracker } from '../../src/vision/state-sync';
import type { ParsedGameState } from '../../../shared/src/vision/parser-types';

describe('State Sync', () => {
  let tracker: StateSyncTracker;

  beforeEach(() => {
    tracker = new StateSyncTracker(5); // Small history for testing
  });

  const createMockState = (pot: number, stacks: Record<string, number>): ParsedGameState => ({
    handId: 'test',
    gameType: 'NLHE_6max',
    blinds: { small: 5, big: 10 },
    positions: {
      hero: 'HERO',
      button: 'BTN',
      smallBlind: 'SB',
      bigBlind: 'BB'
    },
    players: new Map(Object.entries(stacks).map(([pos, stack]) => [
      pos,
      { stack, holeCards: pos === 'HERO' ? [{ rank: 'A', suit: 's' }] : undefined }
    ])),
    communityCards: [],
    pot,
    street: 'preflop',
    actionHistory: [],
    legalActions: [],
    confidence: { overall: 0.9, perElement: new Map() },
    latency: 30,
    parseErrors: [],
    missingElements: [],
    inferredValues: {}
  });

  it('detects impossible pot decrease', () => {
    const state1 = createMockState(100, { HERO: 1000, BTN: 500 });
    const state2 = createMockState(50, { HERO: 1000, BTN: 500 }); // Pot decreased

    tracker.addFrame(state1);
    const errors = tracker.detectInconsistencies(state2);

    expect(errors).toContain('Pot decreased from 100 to 50');
  });

  it('detects impossible stack increase mid-hand', () => {
    const state1 = createMockState(100, { HERO: 900, BTN: 500 }); // Hero went all-in
    const state2 = createMockState(200, { HERO: 950, BTN: 450 }); // Hero stack increased

    tracker.addFrame(state1);
    const errors = tracker.detectInconsistencies(state2);

    expect(errors.some(e => e.includes('stack') && e.includes('increased'))).toBe(true);
  });

  it('allows valid state transitions', () => {
    const state1 = createMockState(0, { HERO: 1000, BTN: 500 });
    const state2 = createMockState(20, { HERO: 990, BTN: 490 }); // Blinds posted

    tracker.addFrame(state1);
    const errors = tracker.detectInconsistencies(state2);

    expect(errors).toHaveLength(0);
  });

  it('tracks consecutive error count', () => {
    // Add states with parse errors
    const errorState: ParsedGameState = {
      ...createMockState(100, { HERO: 1000 }),
      parseErrors: ['Test error']
    };

    tracker.addFrame(errorState);
    tracker.addFrame(errorState);
    tracker.addFrame(errorState);

    expect(tracker.getConsecutiveErrorCount()).toBe(3);
  });
});