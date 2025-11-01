import { describe, it, expect } from 'vitest';
import { detectForcedAction, isForcedBlind, isForcedAllIn } from '../../src/safety/forced-actions';
import type { GameState } from '@poker-bot/shared/src/types';

describe('Forced Action Handling', () => {
  it('detects forced small blind', () => {
    const state: GameState = {
      handId: 'test',
      gameType: 'NLHE_6max',
      blinds: { small: 1, big: 2 },
      positions: {
        hero: 'SB',
        button: 'BTN',
        smallBlind: 'SB',
        bigBlind: 'BB',
      },
      players: new Map([
        ['SB', { stack: 1000 }],
      ]),
      communityCards: [],
      pot: 0,
      street: 'preflop',
      actionHistory: [],
      legalActions: [],
      confidence: {
        overall: 1.0,
        perElement: new Map(),
      },
      latency: 0,
    };

    const isForced = isForcedBlind(state, 'SB');
    expect(isForced).toBe(true);
  });

  it('detects forced all-in', () => {
    const state: GameState = {
      handId: 'test',
      gameType: 'NLHE_6max',
      blinds: { small: 1, big: 2 },
      positions: {
        hero: 'BB',
        button: 'BTN',
        smallBlind: 'SB',
        bigBlind: 'BB',
      },
      players: new Map([
        ['BB', { stack: 1 }], // Less than 2x BB
      ]),
      communityCards: [],
      pot: 3,
      street: 'preflop',
      actionHistory: [],
      legalActions: [],
      confidence: {
        overall: 1.0,
        perElement: new Map(),
      },
      latency: 0,
    };

    const isForced = isForcedAllIn(state, 'BB');
    expect(isForced).toBe(true);
  });
});
