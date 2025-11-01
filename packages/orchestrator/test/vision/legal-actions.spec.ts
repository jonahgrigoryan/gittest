import { describe, it, expect } from 'vitest';
import { computeLegalActions, canCheck, canCall, canRaise } from '../../src/vision/legal-actions';
import type { GameState } from '@poker-bot/shared/src/types';

describe('Legal Actions Calculator', () => {
  it('computes legal actions correctly', () => {
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
        ['BB', { stack: 1000 }],
      ]),
      communityCards: [],
      pot: 3,
      street: 'preflop',
      actionHistory: [],
      legalActions: [],
      confidence: { overall: 1.0, perElement: new Map() },
      latency: 0,
    };

    const actions = computeLegalActions(state);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('determines if check is legal', () => {
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
      players: new Map(),
      communityCards: [],
      pot: 3,
      street: 'preflop',
      actionHistory: [],
      legalActions: [],
      confidence: { overall: 1.0, perElement: new Map() },
      latency: 0,
    };

    expect(canCheck(state)).toBe(true);
  });

  it('determines if raise is legal', () => {
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
        ['BB', { stack: 1000 }],
      ]),
      communityCards: [],
      pot: 3,
      street: 'preflop',
      actionHistory: [],
      legalActions: [],
      confidence: { overall: 1.0, perElement: new Map() },
      latency: 0,
    };

    const raiseInfo = canRaise(state);
    expect(raiseInfo.legal).toBe(true);
    expect(raiseInfo.minRaise).toBe(4); // 2 * big blind
  });
});
