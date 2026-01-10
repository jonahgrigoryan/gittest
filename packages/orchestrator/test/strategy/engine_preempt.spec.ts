import { describe, it, expect, vi } from 'vitest';
import { StrategyEngine } from '../../src/strategy/engine';
import type { StrategyConfig } from '../../src/strategy/types';

describe('StrategyEngine Error Handling', () => {
  it('should log warning and return false when timeBudgetTracker.shouldPreempt throws', () => {
    const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const mockTracker = {
      shouldPreempt: vi.fn(() => {
        throw new Error('Tracker failure');
      }),
    };

    const config: StrategyConfig = {
      mode: 'balanced',
      rngSeed: 123,
      betSizing: { quantization: 'nearest' },
      blending: { method: 'gto_base', agentWeight: 0.5 },
    };

    // Risk controller won't be used if we only call shouldPreempt()
    const riskController = {} as any;

    const engine = new StrategyEngine(config, riskController, {
      logger: mockLogger,
      timeBudgetTracker: mockTracker as any,
    });

    // Call the private method directly
    // @ts-expect-error - testing private method intentionally
    const result = (engine as any).shouldPreempt();

    expect(result).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('StrategyEngine: error in shouldPreempt'),
      expect.objectContaining({ error: 'Tracker failure' }),
    );
  });
});
 
