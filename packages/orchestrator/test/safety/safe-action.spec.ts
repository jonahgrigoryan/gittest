import { describe, it, expect } from 'vitest';
import { shouldTriggerSafeAction, selectSafeAction } from '../../src/safety/safe-action';
import type { ParsedGameState } from '../../src/vision/parser-types';
import type { BotConfig } from '@poker-bot/shared/src/config/types';

describe('SafeAction Selection', () => {
  const config: BotConfig = {
    compliance: {
      gameType: 'NLHE_6max',
      blinds: { small: 1, big: 2 },
      allowedEnvironments: ['private_sim'],
      siteAllowlist: [],
    },
    vision: {
      layoutPack: 'simulator/default.layout.json',
      dpiCalibration: 1.0,
      confidenceThreshold: 0.995,
      occlusionThreshold: 0.05,
    },
    gto: {
      cachePath: '/tmp',
      subgameBudgetMs: 1000,
      deepStackThreshold: 200,
    },
    agents: {
      models: [],
      timeoutMs: 5000,
      outputSchema: {},
    },
    strategy: {
      alphaGTO: 0.5,
      betSizingSets: {
        preflop: [0.5, 1.0],
        flop: [0.5, 1.0],
        turn: [0.5, 1.0],
        river: [0.5, 1.0],
      },
      divergenceThresholdPP: 10,
    },
    execution: {
      mode: 'simulator',
    },
    safety: {
      bankrollLimit: 10000,
      sessionLimit: 1000,
      panicStopConfidenceThreshold: 0.9,
      panicStopConsecutiveFrames: 5,
    },
    logging: {
      retentionDays: 30,
      exportFormats: ['json'],
    },
  };

  it('selects check preflop when legal', () => {
    const state: ParsedGameState = {
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
      legalActions: [
        { type: 'check', position: 'BB', street: 'preflop' },
        { type: 'fold', position: 'BB', street: 'preflop' },
      ],
      confidence: {
        overall: 0.99,
        perElement: new Map(),
      },
      latency: 30,
      parseErrors: [],
      missingElements: [],
      inferredValues: {},
    };

    const action = selectSafeAction(state);
    expect(action.type).toBe('check');
  });

  it('selects fold when check not legal', () => {
    const state: ParsedGameState = {
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
      legalActions: [
        { type: 'fold', position: 'BB', street: 'preflop' },
        { type: 'call', position: 'BB', street: 'preflop' },
      ],
      confidence: {
        overall: 0.99,
        perElement: new Map(),
      },
      latency: 30,
      parseErrors: [],
      missingElements: [],
      inferredValues: {},
    };

    const action = selectSafeAction(state);
    expect(action.type).toBe('fold');
  });

  it('triggers SafeAction when confidence below threshold', () => {
    const state: ParsedGameState = {
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
      legalActions: [
        { type: 'check', position: 'BB', street: 'preflop' },
        { type: 'fold', position: 'BB', street: 'preflop' },
      ],
      confidence: {
        overall: 0.99,
        perElement: new Map(),
      },
      latency: 30,
      parseErrors: [],
      missingElements: [],
      inferredValues: {},
    };

    const shouldTrigger = shouldTriggerSafeAction(state, config);
    expect(shouldTrigger).toBe(true); // 0.99 < 0.995
  });

  it('does not trigger when confidence above threshold', () => {
    const state: ParsedGameState = {
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
      confidence: {
        overall: 0.996,
        perElement: new Map(),
      },
      latency: 30,
      parseErrors: [],
      missingElements: [],
      inferredValues: {},
    };

    const shouldTrigger = shouldTriggerSafeAction(state, config);
    expect(shouldTrigger).toBe(false);
  });
});
