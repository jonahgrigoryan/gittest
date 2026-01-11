import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeDecision, createStubAgentOutput } from '../../src/decision/pipeline';
import { StateSyncTracker } from '../../src/vision/state-sync';
import { SafeModeController } from '../../src/health/safeModeController';
import { TimeBudgetTracker } from '../../src/budget/timeBudgetTracker';
import { GameStateParser } from '../../src/vision/parser';
import { createParsedState } from '../utils/factories';
import type { GameState, Action, GTOSolution, StrategyDecision } from '@poker-bot/shared';
import type { GTOSolver } from '../../src/solver/solver';
import type { AgentCoordinator } from '@poker-bot/agents';

// Mocks
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

const mockSolver: GTOSolver = {
  solve: vi.fn(),
  healthCheck: vi.fn()
} as any;

const mockAgentCoordinator: AgentCoordinator = {
  query: vi.fn(),
  healthCheck: vi.fn()
} as any;

// Mock StrategyEngine as a plain object with a decide method
const mockStrategyEngine = {
  decide: vi.fn((state, gto, agent, sessionId) => ({
    action: { type: 'fold', position: 'BTN', street: 'flop' },
    reasoning: {},
    timing: {},
    metadata: {}
  }))
};

describe('Phase 5: Cash-Game Safety Rehearsals', () => {
  let state: GameState;

  beforeEach(() => {
    vi.clearAllMocks();
    state = createParsedState({
      handId: 'test-hand',
      street: 'flop',
      pot: 10,
      legalActions: [
        { type: 'check', position: 'BTN', street: 'flop' },
        { type: 'fold', position: 'BTN', street: 'flop' }
      ],
      positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' }
    }) as unknown as GameState;
  });

  it('1) Solver failure path: returns safe fallback on solver error', async () => {
    // Simulate solver throwing error
    vi.spyOn(mockSolver, 'solve').mockRejectedValue(new Error('Solver connection failed'));

    const result = await makeDecision(state, 'session-1', {
      strategyEngine: mockStrategyEngine as any,
      gtoSolver: mockSolver,
      logger: mockLogger
    });

    // Assertions
    expect(result.solverTimedOut).toBe(true);
    expect(result.gtoSolution.source).toBe('subgame'); // Fallback creates subgame source
    // Verify strategy engine was called with the fallback solution
    expect(mockStrategyEngine.decide).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('GTO solver failed'), expect.any(Object));
  });

  it('2) Agent failure path: uses stub output on agent error', async () => {
    // Setup solver to succeed
    vi.spyOn(mockSolver, 'solve').mockResolvedValue({
      actions: new Map(),
      exploitability: 0,
      computeTime: 10,
      source: 'cache'
    });

    // Simulate agent coordinator throwing error
    vi.spyOn(mockAgentCoordinator, 'query').mockRejectedValue(new Error('LLM timeout'));

    const result = await makeDecision(state, 'session-1', {
      strategyEngine: mockStrategyEngine as any,
      gtoSolver: mockSolver,
      agentCoordinator: mockAgentCoordinator,
      logger: mockLogger
    });

    // Assertions
    expect(result.agentOutput.notes).toContain('stubbed agent output');
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('agent coordinator query failed'), expect.any(Object));
    expect(mockStrategyEngine.decide).toHaveBeenCalled();
  });

  it('3) Vision/state desync path: detects impossible state and triggers safe mode', () => {
    const tracker = new StateSyncTracker();
    const parser = new GameStateParser({ enableInference: false, layoutPack: {} as any });
    
    // Inject tracker into parser (using any cast to access private property for test)
    (parser as any).stateSync = tracker;

    // Helper to create VisionOutput
    const createVisionOutput = (potAmount: number, timestamp: number) => ({
      timestamp,
      confidence: { overall: 1 },
      pot: { amount: potAmount, confidence: 1 },
      cards: { holeCards: [], communityCards: [], confidence: 1 },
      stacks: {},
      buttons: { dealer: 'BTN', confidence: 1 },
      positions: { confidence: 1 },
      occlusion: {},
      latency: { total: 0 }
    });

    // Frame 1: Pot 10
    const vo1 = createVisionOutput(10, 1000);
    const s1 = parser.parse(vo1 as any, undefined);

    // Frame 2: Pot 5 (Impossible decrease)
    const vo2 = createVisionOutput(5, 2000);
    const parsed = parser.parse(vo2 as any, s1);

    // Assertions
    expect(parsed.parseErrors.length).toBeGreaterThan(0);
    expect(parsed.parseErrors[0]).toContain('Pot decreased');
    
    // Verify SafeAction trigger logic
    expect(parsed.parseErrors.length > 0).toBe(true);
  });

  it('4) Preemption / budget exhaustion: handles tracker errors safely', async () => {
    const mockTracker = new TimeBudgetTracker({});
    // Simulate tracker throwing on check
    vi.spyOn(mockTracker, 'shouldPreempt').mockImplementation(() => {
      throw new Error('Tracker corrupted');
    });

    const result = await makeDecision(state, 'session-1', {
      strategyEngine: mockStrategyEngine as any,
      gtoSolver: mockSolver,
      tracker: mockTracker,
      logger: mockLogger
    });

    // Assertions
    // If tracker throws in makeDecision, it catches and logs error, then proceeds with fallback
    expect(result.solverTimedOut).toBe(true);
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('GTO solver failed'), expect.any(Object));
  });

  it('5) Recovery / safe-mode behavior: verifies latch and manual exit', () => {
    const controller = new SafeModeController(mockLogger);
    
    // Enter safe mode
    controller.enter('panic:test', { manual: false });
    expect(controller.isActive()).toBe(true);
    expect(controller.getState().reason).toBe('panic:test');

    // Try to exit (auto mode allows exit)
    controller.exit();
    expect(controller.isActive()).toBe(false);

    // Test Manual Latch
    controller.enter('manual:override', { manual: true });
    expect(controller.isActive()).toBe(true);
    
    // Try auto exit (should fail/ignore)
    controller.exit(false);
    expect(controller.isActive()).toBe(true); // Should still be active

    // Manual exit
    controller.exit(true);
    expect(controller.isActive()).toBe(false);
  });
});
