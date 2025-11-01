import { describe, it, expect } from 'vitest';
import { detectForcedAction, isForcedBlind, isForcedAllIn } from '../../src/safety/forced-actions';
import type { GameState, Position } from '../../../shared/src/types';

describe('Forced Action Handling', () => {
  const createMockState = (
    heroPosition: Position,
    heroStack: number,
    actionHistory: any[] = []
  ): GameState => ({
    handId: 'test',
    gameType: 'NLHE_6max',
    blinds: { small: 5, big: 10 },
    positions: {
      hero: heroPosition,
      button: 'BTN',
      smallBlind: 'SB',
      bigBlind: 'BB'
    },
    players: new Map([[heroPosition, { stack: heroStack }]]),
    communityCards: [],
    pot: 15,
    street: 'preflop',
    actionHistory,
    legalActions: [],
    confidence: { overall: 0.9, perElement: new Map() },
    latency: 30
  });

  it('detects forced small blind', () => {
    const state = createMockState('SB', 1000, []); // No actions yet
    expect(isForcedBlind(state, 'SB')).toBe(true);
  });

  it('detects forced big blind', () => {
    const state = createMockState('BB', 1000, []); // No actions yet
    expect(isForcedBlind(state, 'BB')).toBe(true);
  });

  it('detects forced all-in', () => {
    const state = createMockState('HERO', 5, []); // Stack < big blind
    expect(isForcedAllIn(state, 'HERO')).toBe(true);
  });

  it('posts blinds automatically', () => {
    const state = createMockState('SB', 1000, []);
    const action = detectForcedAction(state, 'SB');

    expect(action).toBeDefined();
    expect(action!.type).toBe('call');
    expect(action!.amount).toBe(5); // Small blind amount
  });

  it('does not override forced actions with SafeAction', () => {
    const state = createMockState('SB', 1000, []);
    const action = detectForcedAction(state, 'SB');

    // Forced action should take precedence over safe actions
    expect(action).toBeDefined();
    expect(action!.type).toBe('call'); // Forced blind, not safe fold
  });

  it('returns null when no forced action', () => {
    const state = createMockState('HERO', 1000, [
      // Some actions already taken
      { type: 'call', amount: 5, position: 'SB', street: 'preflop' },
      { type: 'call', amount: 10, position: 'BB', street: 'preflop' }
    ]);

    const action = detectForcedAction(state, 'HERO');
    expect(action).toBeNull();
  });
});