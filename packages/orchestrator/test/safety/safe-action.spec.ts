import { describe, it, expect } from 'vitest';
import { selectSafeAction } from '../../src/safety/safe-action';
import type { ParsedGameState } from '../../../shared/src/vision/parser-types';

describe('SafeAction Selection', () => {
  const createMockState = (street: string, hasBet: boolean = false): ParsedGameState => ({
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
    street: street as any,
    actionHistory: [],
    legalActions: [
      { type: 'fold', position: 'HERO', street: street as any },
      ...(hasBet ? [] : [{ type: 'check', position: 'HERO', street: street as any }]),
      ...(hasBet ? [{ type: 'call', amount: 10, position: 'HERO', street: street as any }] : [])
    ],
    confidence: { overall: 0.9, perElement: new Map() },
    latency: 30,
    parseErrors: [],
    missingElements: [],
    inferredValues: {}
  });

  it('selects check preflop when legal', () => {
    const state = createMockState('preflop', false); // No bet
    const action = selectSafeAction(state);

    expect(action.type).toBe('check');
    expect(action.position).toBe('HERO');
  });

  it('selects fold preflop when check not legal', () => {
    const state = createMockState('preflop', true); // Bet facing
    const action = selectSafeAction(state);

    expect(action.type).toBe('fold');
    expect(action.position).toBe('HERO');
  });

  it('selects check postflop when legal', () => {
    const state = createMockState('flop', false); // No bet
    const action = selectSafeAction(state);

    expect(action.type).toBe('check');
  });

  it('selects fold postflop when check not legal', () => {
    const state = createMockState('flop', true); // Bet facing
    const action = selectSafeAction(state);

    expect(action.type).toBe('fold');
  });

  it('never selects raise in safe mode', () => {
    const state = createMockState('preflop', false);
    // Add raise to legal actions
    state.legalActions.push({
      type: 'raise',
      amount: 25,
      position: 'HERO',
      street: 'preflop'
    });

    const action = selectSafeAction(state);
    expect(action.type).not.toBe('raise');
  });
});