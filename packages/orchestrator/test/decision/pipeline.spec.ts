import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  makeDecision,
  createStubAgentOutput,
} from "../../src/decision/pipeline";
import { TimeBudgetTracker } from "../../src/budget/timeBudgetTracker";
import { createParsedState } from "../utils/factories";
import { createActionKey } from "@poker-bot/shared";
import type {
  GameState,
  Action,
  GTOSolution,
  ActionSolutionEntry,
} from "@poker-bot/shared";
import type { GTOSolver } from "../../src/solver/solver";
import type {
  AgentCoordinator,
  AggregatedAgentOutput,
} from "@poker-bot/agents";
import type { StrategyEngine } from "../../src/strategy/engine";

// Mock logger
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Helper to create a minimal mock solver
function createMockSolver(
  behavior: "success" | "timeout" | "error" = "success",
): GTOSolver {
  const mock = {
    solve: vi.fn(),
  } as unknown as GTOSolver;

  if (behavior === "success") {
    const fold: Action = { type: "fold", position: "BTN", street: "flop" };
    const check: Action = { type: "check", position: "BTN", street: "flop" };
    const actions = new Map<string, ActionSolutionEntry>();
    actions.set(createActionKey(fold), {
      action: fold,
      solution: { frequency: 0.3, ev: -5 },
    });
    actions.set(createActionKey(check), {
      action: check,
      solution: { frequency: 0.7, ev: 0 },
    });
    vi.spyOn(mock, "solve").mockResolvedValue({
      actions,
      exploitability: 0.01,
      computeTime: 50,
      source: "cache",
    });
  } else if (behavior === "timeout") {
    vi.spyOn(mock, "solve").mockImplementation(async (_state, budget) => {
      if (budget === 0) {
        // Return safe fallback when budget is 0
        const check: Action = {
          type: "check",
          position: "BTN",
          street: "flop",
        };
        const actions = new Map<string, ActionSolutionEntry>();
        actions.set(createActionKey(check), {
          action: check,
          solution: { frequency: 1, ev: 0 },
        });
        return {
          actions,
          exploitability: 1,
          computeTime: 0,
          source: "subgame",
        };
      }
      throw new Error("Solver timeout");
    });
  } else {
    vi.spyOn(mock, "solve").mockRejectedValue(
      new Error("Solver connection failed"),
    );
  }

  return mock;
}

// Helper to create a minimal mock agent coordinator
function createMockAgentCoordinator(
  behavior: "success" | "timeout" | "error" = "success",
): AgentCoordinator {
  const mock = {
    query: vi.fn(),
  } as unknown as AgentCoordinator;

  if (behavior === "success") {
    vi.spyOn(mock, "query").mockResolvedValue({
      outputs: [
        {
          agentId: "test",
          personaId: "gto",
          reasoning: "test",
          action: "check",
          confidence: 0.8,
          latencyMs: 50,
        },
      ],
      normalizedActions: new Map([
        ["fold", 0.1],
        ["check", 0.6],
        ["call", 0.2],
        ["raise", 0.1],
      ]),
      consensus: 0.7,
      winningAction: "check",
      budgetUsedMs: 100,
      circuitBreakerTripped: false,
      startedAt: Date.now(),
      completedAt: Date.now(),
    } as AggregatedAgentOutput);
  } else if (behavior === "timeout") {
    vi.spyOn(mock, "query").mockRejectedValue(
      new Error("Agent coordinator timeout"),
    );
  } else {
    vi.spyOn(mock, "query").mockRejectedValue(
      new Error("Agent coordinator error"),
    );
  }

  return mock;
}

// Helper to create a mock strategy engine
function createMockStrategyEngine(): StrategyEngine {
  return {
    decide: vi.fn((_state, gto, _agent, _sessionId) => {
      // Pick first action from GTO solution or safe fallback
      let selectedAction: Action = {
        type: "fold",
        position: "BTN",
        street: "flop",
      };
      if (gto.actions && gto.actions.size > 0) {
        const first = gto.actions.values().next().value;
        if (first?.action) {
          selectedAction = first.action;
        }
      }
      return {
        action: selectedAction,
        reasoning: {
          gtoRecommendation: new Map(),
          agentRecommendation: new Map(),
          blendedDistribution: new Map(),
          alpha: 0.6,
          divergence: 0,
          riskCheckPassed: true,
          sizingQuantized: false,
        },
        timing: { gtoTime: 10, agentTime: 10, synthesisTime: 5, totalTime: 25 },
        metadata: {
          rngSeed: 12345,
          configSnapshot: {
            alphaGTO: 0.6,
            betSizingSets: { preflop: [], flop: [], turn: [], river: [] },
            divergenceThresholdPP: 30,
          },
        },
      };
    }),
  } as unknown as StrategyEngine;
}

// Helper to create a test game state
function createTestState(overrides: Partial<GameState> = {}): GameState {
  const base = createParsedState({
    handId: "test-hand-001",
    street: "flop",
    pot: 20,
    legalActions: [
      { type: "check", position: "BTN", street: "flop" },
      { type: "fold", position: "BTN", street: "flop" },
      { type: "raise", position: "BTN", street: "flop", amount: 10 },
    ],
    positions: { hero: "BTN", button: "BTN", smallBlind: "SB", bigBlind: "BB" },
  });
  return { ...base, ...overrides } as unknown as GameState;
}

describe("Phase 12: Decision Pipeline E2E Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1) GTO solver timeout / 0ms budget", () => {
    it("returns safe fallback when budget is 0ms", async () => {
      const state = createTestState();
      const solver = createMockSolver("timeout");
      const engine = createMockStrategyEngine();

      // Create tracker with 0ms remaining for GTO
      const tracker = new TimeBudgetTracker({
        totalBudgetMs: 10,
        allocation: {
          perception: 0,
          gto: 0, // 0ms budget for GTO
          agents: 0,
          synthesis: 0,
          execution: 0,
          buffer: 10,
        },
      });
      tracker.start();
      // Consume all time
      tracker.recordActual("buffer", 10);

      const result = await makeDecision(state, "session-1", {
        strategyEngine: engine,
        gtoSolver: solver,
        tracker,
        logger: mockLogger,
      });

      // Verify solver was called with 0ms budget
      expect(solver.solve).toHaveBeenCalled();
      // Pipeline should mark solver as timed out
      expect(result.solverTimedOut).toBe(true);
      // GTO solution should be a fallback (source: subgame with high exploitability)
      expect(result.gtoSolution).toBeDefined();
      expect(result.gtoSolution.actions.size).toBeGreaterThan(0);
    });

    it("aborts immediately when tracker signals preemption", async () => {
      const state = createTestState();
      const solver = createMockSolver("success");
      const engine = createMockStrategyEngine();

      // Create tracker that always signals preemption
      const tracker = {
        shouldPreempt: vi.fn().mockReturnValue(true),
        remaining: vi.fn().mockReturnValue(0),
        reserve: vi.fn().mockReturnValue(false),
        release: vi.fn(),
        start: vi.fn(),
        startComponent: vi.fn(),
        endComponent: vi.fn().mockReturnValue(0),
      } as unknown as TimeBudgetTracker;

      const result = await makeDecision(state, "session-1", {
        strategyEngine: engine,
        gtoSolver: solver,
        tracker,
        logger: mockLogger,
      });

      expect(result.solverTimedOut).toBe(true);
      // Solver should be called with 0 budget due to preemption
      expect(solver.solve).toHaveBeenCalledWith(state, 0);
    });
  });

  describe("2) Agent coordinator timeout", () => {
    it("uses stub output when agent coordinator times out", async () => {
      const state = createTestState();
      const solver = createMockSolver("success");
      const agents = createMockAgentCoordinator("timeout");
      const engine = createMockStrategyEngine();

      const result = await makeDecision(state, "session-1", {
        strategyEngine: engine,
        gtoSolver: solver,
        agentCoordinator: agents,
        logger: mockLogger,
      });

      // Verify agent output is stubbed
      expect(result.agentOutput.notes).toContain("stubbed agent output");
      expect(result.agentOutput.outputs).toHaveLength(0);
      expect(result.agentOutput.circuitBreakerTripped).toBe(false);
      // Warning should be logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("agent coordinator query failed"),
        expect.any(Object),
      );
    });

    it("uses GTO-only fallback when agent coordinator errors", async () => {
      const state = createTestState();
      const solver = createMockSolver("success");
      const agents = createMockAgentCoordinator("error");
      const engine = createMockStrategyEngine();

      const result = await makeDecision(state, "session-1", {
        strategyEngine: engine,
        gtoSolver: solver,
        agentCoordinator: agents,
        logger: mockLogger,
      });

      // Strategy engine should still be called with stub agent output
      expect(engine.decide).toHaveBeenCalled();
      // Result should have valid GTO solution
      expect(result.gtoSolution.actions.size).toBeGreaterThan(0);
      // Agent output should be stubbed
      expect(result.agentOutput.notes).toContain("stubbed");
    });
  });

  describe("3) Empty legal actions", () => {
    it("returns safe no-op decision when legalActions is empty", async () => {
      const state = createTestState({ legalActions: [] });
      const solver = createMockSolver("success");
      const engine = createMockStrategyEngine();

      const result = await makeDecision(state, "session-1", {
        strategyEngine: engine,
        gtoSolver: solver,
        logger: mockLogger,
      });

      // Pipeline should not crash
      expect(result.decision).toBeDefined();
      expect(result.decision.action).toBeDefined();
      // The decision should be some form of safe fallback
      expect(["fold", "check"]).toContain(result.decision.action.type);
    });

    it("handles undefined legalActions gracefully", async () => {
      const state = createTestState();
      // Force legalActions to be undefined
      (state as any).legalActions = undefined;

      const solver = createMockSolver("success");
      const engine = createMockStrategyEngine();

      const result = await makeDecision(state, "session-1", {
        strategyEngine: engine,
        gtoSolver: solver,
        logger: mockLogger,
      });

      // Pipeline should not throw
      expect(result.decision).toBeDefined();
    });
  });

  describe("4) Concurrent GTO + agent budget exhaustion", () => {
    it("handles simultaneous budget exhaustion deterministically", async () => {
      const state = createTestState();
      const solver = createMockSolver("timeout");
      const agents = createMockAgentCoordinator("timeout");
      const engine = createMockStrategyEngine();

      // Create tracker with minimal/exhausted budgets
      const tracker = new TimeBudgetTracker({
        totalBudgetMs: 50,
        allocation: {
          perception: 0,
          gto: 10,
          agents: 10,
          synthesis: 10,
          execution: 10,
          buffer: 10,
        },
      });
      tracker.start();
      // Exhaust all budgets
      tracker.recordActual("perception", 50);

      const result = await makeDecision(state, "session-1", {
        strategyEngine: engine,
        gtoSolver: solver,
        agentCoordinator: agents,
        tracker,
        logger: mockLogger,
      });

      // Pipeline should produce a valid result without exceptions
      expect(result).toBeDefined();
      expect(result.decision).toBeDefined();
      expect(result.gtoSolution).toBeDefined();
      expect(result.agentOutput).toBeDefined();

      // Budgets should never go negative
      const snapshot = tracker.allocationSnapshot();
      for (const [component, allocation] of Object.entries(snapshot)) {
        expect(allocation).toBeGreaterThanOrEqual(0);
      }
    });

    it("produces deterministic safe outcome when all budgets exhausted", async () => {
      const state = createTestState();
      const solver = createMockSolver("timeout");
      const engine = createMockStrategyEngine();

      // Run multiple times to verify determinism
      const results: Awaited<ReturnType<typeof makeDecision>>[] = [];

      for (let i = 0; i < 3; i++) {
        const tracker = new TimeBudgetTracker({
          totalBudgetMs: 0,
          allocation: {
            perception: 0,
            gto: 0,
            agents: 0,
            synthesis: 0,
            execution: 0,
            buffer: 0,
          },
        });

        const result = await makeDecision(state, "session-1", {
          strategyEngine: engine,
          gtoSolver: solver,
          tracker,
          logger: mockLogger,
        });

        results.push(result);
      }

      // All results should have the same structure
      expect(results[0].solverTimedOut).toBe(results[1].solverTimedOut);
      expect(results[1].solverTimedOut).toBe(results[2].solverTimedOut);
      // All should indicate timeout
      expect(results.every((r) => r.solverTimedOut)).toBe(true);
    });
  });

  describe("5) Blending safety: GTO distribution validation", () => {
    it("replaces empty GTO distribution with safe fallback before blending", async () => {
      const state = createTestState();

      // Create solver that returns empty actions
      const solver = {
        solve: vi.fn().mockResolvedValue({
          actions: new Map(),
          exploitability: 0,
          computeTime: 0,
          source: "cache",
        }),
      } as unknown as GTOSolver;

      const engine = createMockStrategyEngine();

      const result = await makeDecision(state, "session-1", {
        strategyEngine: engine,
        gtoSolver: solver,
        logger: mockLogger,
      });

      expect(result.solverTimedOut).toBe(true);
      expect(result.gtoSolution.actions.size).toBe(1);
      const entry = result.gtoSolution.actions.values().next().value;
      expect(entry.solution.frequency).toBe(1);
      expect(result.gtoSolution.source).toBe("subgame");
    });

    it("passes non-empty GTO solution to strategy engine when solver returns empty", async () => {
      const state = createTestState();

      // Create solver that returns empty actions
      const solver = {
        solve: vi.fn().mockResolvedValue({
          actions: new Map(),
          exploitability: 0,
          computeTime: 0,
          source: "cache",
        }),
      } as unknown as GTOSolver;

      const engine = createMockStrategyEngine();

      const result = await makeDecision(state, "session-1", {
        strategyEngine: engine,
        gtoSolver: solver,
        logger: mockLogger,
      });

      expect(engine.decide).toHaveBeenCalled();
      const gtoSolutionArg = (engine.decide as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as GTOSolution;
      expect(gtoSolutionArg.actions.size).toBeGreaterThan(0);
    });
  });

  describe("createSafeFallbackSolution correctness", () => {
    it("returns proper frequency distribution with single action", async () => {
      const state = createTestState({
        legalActions: [{ type: "check", position: "BTN", street: "flop" }],
      });

      // Force solver to fail so createSafeFallbackSolution is used
      const solver = {
        solve: vi.fn().mockRejectedValue(new Error("Solver failed")),
      } as unknown as GTOSolver;

      const engine = createMockStrategyEngine();

      const result = await makeDecision(state, "session-1", {
        strategyEngine: engine,
        gtoSolver: solver,
        logger: mockLogger,
      });

      // Verify fallback solution structure
      expect(result.gtoSolution.actions.size).toBe(1);
      const entry = result.gtoSolution.actions.values().next().value;
      expect(entry.solution.frequency).toBe(1);
      expect(entry.solution.ev).toBe(0);
      expect(result.gtoSolution.exploitability).toBe(1);
      expect(result.gtoSolution.computeTime).toBe(0);
      expect(result.gtoSolution.source).toBe("subgame");
    });

    it("prefers check/call over fold in safe fallback", async () => {
      const state = createTestState({
        legalActions: [
          { type: "fold", position: "BTN", street: "flop" },
          { type: "check", position: "BTN", street: "flop" },
        ],
      });

      const solver = {
        solve: vi.fn().mockRejectedValue(new Error("Solver failed")),
      } as unknown as GTOSolver;

      const engine = createMockStrategyEngine();

      const result = await makeDecision(state, "session-1", {
        strategyEngine: engine,
        gtoSolver: solver,
        logger: mockLogger,
      });

      // Safe fallback should prefer check over fold
      const entry = result.gtoSolution.actions.values().next().value;
      expect(entry.action.type).toBe("check");
    });

    it("creates synthetic fold when no legal actions available", async () => {
      const state = createTestState({ legalActions: [] });

      const solver = {
        solve: vi.fn().mockRejectedValue(new Error("Solver failed")),
      } as unknown as GTOSolver;

      const engine = createMockStrategyEngine();

      const result = await makeDecision(state, "session-1", {
        strategyEngine: engine,
        gtoSolver: solver,
        logger: mockLogger,
      });

      // Should create synthetic fold
      expect(result.gtoSolution.actions.size).toBe(1);
      const entry = result.gtoSolution.actions.values().next().value;
      expect(entry.action.type).toBe("fold");
      expect(entry.action.position).toBe("BTN");
    });
  });

  describe("stub agent output correctness", () => {
    it("createStubAgentOutput returns valid structure", () => {
      const stub = createStubAgentOutput();

      expect(stub.outputs).toHaveLength(0);
      expect(stub.normalizedActions).toBeInstanceOf(Map);
      expect(stub.normalizedActions.size).toBe(4);
      expect(stub.normalizedActions.get("fold")).toBe(0);
      expect(stub.normalizedActions.get("check")).toBe(0);
      expect(stub.normalizedActions.get("call")).toBe(0);
      expect(stub.normalizedActions.get("raise")).toBe(0);
      expect(stub.consensus).toBe(0);
      expect(stub.winningAction).toBeNull();
      expect(stub.budgetUsedMs).toBe(0);
      expect(stub.circuitBreakerTripped).toBe(false);
      expect(stub.notes).toContain("stubbed");
      expect(stub.droppedAgents).toHaveLength(0);
      expect(stub.costSummary).toBeDefined();
      expect(stub.startedAt).toBeDefined();
      expect(stub.completedAt).toBeDefined();
    });

    it("stub is used when agentCoordinator is not provided", async () => {
      const state = createTestState();
      const solver = createMockSolver("success");
      const engine = createMockStrategyEngine();

      const result = await makeDecision(state, "session-1", {
        strategyEngine: engine,
        gtoSolver: solver,
        // No agentCoordinator provided
        logger: mockLogger,
      });

      expect(result.agentOutput.notes).toContain("stubbed");
      expect(result.agentOutput.outputs).toHaveLength(0);
    });
  });

  describe("error handling and recovery", () => {
    it("handles solver error and logs appropriately", async () => {
      const state = createTestState();
      const solver = createMockSolver("error");
      const engine = createMockStrategyEngine();

      const result = await makeDecision(state, "session-1", {
        strategyEngine: engine,
        gtoSolver: solver,
        logger: mockLogger,
      });

      expect(result.solverTimedOut).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("GTO solver failed"),
        expect.any(Object),
      );
    });

    it("handles both solver and agent failures gracefully", async () => {
      const state = createTestState();
      const solver = createMockSolver("error");
      const agents = createMockAgentCoordinator("error");
      const engine = createMockStrategyEngine();

      const result = await makeDecision(state, "session-1", {
        strategyEngine: engine,
        gtoSolver: solver,
        agentCoordinator: agents,
        logger: mockLogger,
      });

      // Both failed, but pipeline should still produce a valid result
      expect(result).toBeDefined();
      expect(result.decision).toBeDefined();
      expect(result.solverTimedOut).toBe(true);
      expect(result.agentOutput.notes).toContain("stubbed");
    });
  });
});
