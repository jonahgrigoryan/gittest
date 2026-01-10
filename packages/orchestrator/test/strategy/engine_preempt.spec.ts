import { describe, it, expect, vi } from 'vitest';
import { StrategyEngine } from '../../src/strategy/engine';
import { TimeBudgetTracker } from '../../src/budget/timeBudgetTracker';
import type { StrategyConfig } from '../../src/strategy/types';
import type { GameState, GTOSolution } from '@poker-bot/shared';
import type { AggregatedAgentOutput } from '@poker-bot/agents';

describe('StrategyEngine Error Handling', () => {
  it('should log warning and return false when timeBudgetTracker throws', () => {
    // Mock dependencies
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    const mockTracker = {
      remaining: vi.fn().mockImplementation(() => {
        throw new Error('Tracker failure');
      }),
      shouldPreempt: vi.fn(),
      start: vi.fn(),
      reserve: vi.fn(),
      release: vi.fn(),
      startComponent: vi.fn(),
      endComponent: vi.fn()
    } as unknown as TimeBudgetTracker;

    const config: StrategyConfig = {
      mode: 'balanced',
      rngSeed: 123,
      betSizing: { quantization: 'nearest' },
      blending: { method: 'gto_base', agentWeight: 0.5 }
    };

    const riskController = {
      startHand: vi.fn(),
      incrementHandCount: vi.fn(),
      recordOutcome: vi.fn(),
      updateLimits: vi.fn(),
      checkLimits: vi.fn().mockReturnValue({ allowed: true }),
      getSnapshot: vi.fn(),
      resetSession: vi.fn(),
      enforceAction: vi.fn(),
      getSafeAction: vi.fn().mockReturnValue({ type: 'fold', position: 'SB', street: 'preflop' }),
      enforceWithFallback: vi.fn().mockImplementation((action) => ({
        action,
        result: {
          allowed: true,
          snapshot: {
            panicStop: false,
            currentBankroll: 1000,
            currentSessionHands: 0,
            limits: { bankrollLimit: 0, sessionLimit: 0 }
          }
        }
      }))
    };

    const engine = new StrategyEngine(config, riskController as any, {
      logger: mockLogger,
      timeBudgetTracker: mockTracker
    });

    // Mock inputs
    const state = { handId: 'test-hand', positions: { hero: 'SB' }, legalActions: [] } as unknown as GameState;
    const gto = { actions: new Map() } as unknown as GTOSolution;
    const agents = { normalizedActions: new Map(), outputs: [] } as unknown as AggregatedAgentOutput;

    // Execute
    engine.decide(state, gto, agents, 'test-session');

    // Verify
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('StrategyEngine: error in shouldPreempt'),
      expect.objectContaining({ error: 'Tracker failure' })
    );
  });
});
