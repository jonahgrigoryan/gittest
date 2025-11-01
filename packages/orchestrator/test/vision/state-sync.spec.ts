import { describe, it, expect } from 'vitest';
import { StateSyncTracker } from '../../src/vision/state-sync';
import type { ParsedGameState } from '../../src/vision/parser-types';

describe('State Sync Tracker', () => {
  it('detects impossible pot decrease', () => {
    const tracker = new StateSyncTracker();
    
    const state1: ParsedGameState = {
      handId: 'test',
      gameType: 'NLHE_6max',
      blinds: { small: 1, big: 2 },
      positions: {
        hero: 'BB',
        button: 'BTN',
        smallBlind: 'SB',
        bigBlind: 'BB',
      },
      players: new Map(),
      communityCards: [],
      pot: 10,
      street: 'preflop',
      actionHistory: [],
      legalActions: [],
      confidence: { overall: 1.0, perElement: new Map() },
      latency: 0,
      parseErrors: [],
      missingElements: [],
      inferredValues: {},
    };
    
    tracker.addFrame(state1);
    
    const state2: ParsedGameState = {
      ...state1,
      pot: 5, // Pot decreased
    };
    
    const errors = tracker.detectInconsistencies(state2);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('tracks consecutive error count', () => {
    const tracker = new StateSyncTracker();
    
    const state1: ParsedGameState = {
      handId: 'test',
      gameType: 'NLHE_6max',
      blinds: { small: 1, big: 2 },
      positions: {
        hero: 'BB',
        button: 'BTN',
        smallBlind: 'SB',
        bigBlind: 'BB',
      },
      players: new Map(),
      communityCards: [],
      pot: 10,
      street: 'preflop',
      actionHistory: [],
      legalActions: [],
      confidence: { overall: 1.0, perElement: new Map() },
      latency: 0,
      parseErrors: ['error1'],
      missingElements: [],
      inferredValues: {},
    };
    
    tracker.addFrame(state1);
    tracker.addFrame(state1);
    
    expect(tracker.getConsecutiveErrorCount()).toBe(2);
  });
});
