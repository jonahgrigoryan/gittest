import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSolverClient, SolverClientAdapter } from '../../src/solver_client/client';
import * as Shared from '@poker-bot/shared';

// Hoist mocks
const mocks = vi.hoisted(() => ({
  solve: vi.fn(),
  waitForReady: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@poker-bot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof Shared>();
  return {
    ...actual,
    solverGen: {
      ...actual.solverGen,
      SolverClient: vi.fn(() => ({
        solve: mocks.solve,
        waitForReady: mocks.waitForReady,
        close: mocks.close,
      })),
    },
  };
});

describe('SolverClient Contract', () => {
  let client: SolverClientAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.solve.mockReset();
    mocks.waitForReady.mockReset();
    mocks.close.mockReset();
    client = createSolverClient('localhost:50051');
  });

  afterEach(() => {
    vi.useRealTimers();
    client.close();
  });

  it('should handle successful solve', async () => {
    const mockResponse = {
      actions: [
        { actionType: 'fold', frequency: 0.5, ev: 10 },
        { actionType: 'raise', amount: 100, frequency: 0.5, ev: 20 }
      ],
      exploitability: 0.1,
      computeTimeMs: 100,
      source: 'subgame'
    };

    mocks.solve.mockImplementation((req: any, cb: any) => {
      cb(null, mockResponse);
    });

    const request = {
      stateFingerprint: 'test',
      gameStateJson: '{}',
      budgetMs: 1000,
      effectiveStackBb: 100,
      actionSet: []
    };

    const result = await client.solve(request);
    expect(result).toBeDefined();
    expect(result.actions).toHaveLength(2);
    expect(result.exploitability).toBe(0.1);
  });

  it('should enforce timeout', async () => {
    mocks.solve.mockImplementation((req: any, cb: any) => {
      // Hang
    });

    const request = {
      stateFingerprint: 'test',
      gameStateJson: '{}',
      budgetMs: 1000,
      effectiveStackBb: 100,
      actionSet: []
    };

    const promise = client.solve(request);
    
    vi.advanceTimersByTime(30000); // Advance plenty

    await expect(promise).rejects.toThrow(/timeout|deadline/i);
  });

  it('should handle connection failure', async () => {
    const error = new Error('Connect Failed');
    mocks.solve.mockImplementation((req: any, cb: any) => {
      cb(error, null);
    });

    const request = {
      stateFingerprint: 'test',
      gameStateJson: '{}',
      budgetMs: 1000,
      effectiveStackBb: 100,
      actionSet: []
    };

    await expect(client.solve(request)).rejects.toThrow('Connect Failed');
  });

  it('should handle partial response', async () => {
    const partialResponse = {
      actions: [], // Empty actions
      // Missing other fields
    };

    mocks.solve.mockImplementation((req: any, cb: any) => {
      cb(null, partialResponse);
    });

    const request = {
      stateFingerprint: 'test',
      gameStateJson: '{}',
      budgetMs: 1000,
      effectiveStackBb: 100,
      actionSet: []
    };

    const result = await client.solve(request);
    expect(result.actions).toEqual([]);
    expect(result.exploitability).toBe(0);
  });
});
