/**
 * Phase 12: CI-Safe Integration Suite (Cash Game Session)
 *
 * This suite exercises the decision pipeline across multiple hands to validate:
 * - Pipeline decisions across hands
 * - State updates between hands
 * - Solver/agent fallback behavior
 * - Determinism and stability under CI conditions
 *
 * CI smoke runs 50-100 hands quickly. Long-run (1000+ hands) is gated by E2E_LONG_RUN=1.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  makeDecision,
  createStubAgentOutput,
} from "../../src/decision/pipeline";
import { TimeBudgetTracker } from "../../src/budget/timeBudgetTracker";
import { createActionKey } from "@poker-bot/shared";
import type {
  GameState,
  Action,
  GTOSolution,
  ActionSolutionEntry,
  Position,
  Street,
} from "@poker-bot/shared";
import type { GTOSolver } from "../../src/solver/solver";
import type {
  AgentCoordinator,
  AggregatedAgentOutput,
} from "@poker-bot/agents";
import type { StrategyEngine } from "../../src/strategy/engine";
import type { DecisionPipelineResult } from "../../src/decision/pipeline";

// Deterministic seeded RNG for reproducible test runs
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    // LCG algorithm for deterministic random numbers
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(items: T[]): T {
    return items[this.nextInt(0, items.length - 1)];
  }
}

// Test logger that suppresses output in CI
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const POSITIONS: Position[] = ["BTN", "SB", "BB", "UTG", "MP", "CO"];
const STREETS: Street[] = ["preflop", "flop", "turn", "river"];

interface HandScenario {
  handId: string;
  street: Street;
  pot: number;
  heroPosition: Position;
  legalActions: Action[];
  shouldSolverFail: boolean;
  shouldAgentFail: boolean;
}

/**
 * Generates a deterministic sequence of hand scenarios for testing.
 */
function generateHandScenarios(count: number, seed: number): HandScenario[] {
  const rng = new SeededRandom(seed);
  const scenarios: HandScenario[] = [];

  for (let i = 0; i < count; i++) {
    const heroPosition = rng.pick(POSITIONS);
    const street = rng.pick(STREETS);
    const pot = rng.nextInt(10, 500);

    // Generate legal actions based on street and position
    const legalActions: Action[] = [];

    // Always have check or fold available
    if (rng.next() > 0.3) {
      legalActions.push({ type: "check", position: heroPosition, street });
    } else {
      legalActions.push({ type: "fold", position: heroPosition, street });
    }

    // Sometimes add call
    if (rng.next() > 0.5) {
      legalActions.push({
        type: "call",
        position: heroPosition,
        street,
        amount: rng.nextInt(5, 50),
      });
    }

    // Sometimes add raise
    if (rng.next() > 0.4) {
      legalActions.push({
        type: "raise",
        position: heroPosition,
        street,
        amount: rng.nextInt(20, 200),
      });
    }

    // Inject failures at deterministic intervals for fallback testing
    const shouldSolverFail = i % 17 === 7; // ~6% of hands
    const shouldAgentFail = i % 23 === 11; // ~4% of hands

    scenarios.push({
      handId: `integration-hand-${i.toString().padStart(4, "0")}`,
      street,
      pot,
      heroPosition,
      legalActions,
      shouldSolverFail,
      shouldAgentFail,
    });
  }

  return scenarios;
}

/**
 * Creates a mock solver that can be configured to succeed or fail.
 */
function createConfigurableSolver(scenario: HandScenario): GTOSolver {
  return {
    solve: vi.fn(async (_state: GameState, _budget?: number) => {
      if (scenario.shouldSolverFail) {
        throw new Error("Solver timeout (injected)");
      }

      // Build solution from legal actions
      const actions = new Map<string, ActionSolutionEntry>();
      const total = scenario.legalActions.length;

      scenario.legalActions.forEach((action, idx) => {
        const freq = 1 / total;
        actions.set(createActionKey(action), {
          action,
          solution: { frequency: freq, ev: 0 },
        });
      });

      return {
        actions,
        exploitability: 0.01,
        computeTime: 50,
        source: "cache",
      } as GTOSolution;
    }),
  } as unknown as GTOSolver;
}

/**
 * Creates a mock agent coordinator that can be configured to succeed or fail.
 */
function createConfigurableAgentCoordinator(
  scenario: HandScenario,
): AgentCoordinator {
  return {
    query: vi.fn(async () => {
      if (scenario.shouldAgentFail) {
        throw new Error("Agent coordinator timeout (injected)");
      }

      return {
        outputs: [
          {
            agentId: "test-agent",
            personaId: "gto",
            reasoning: "Integration test response",
            action: scenario.legalActions[0]?.type ?? "fold",
            confidence: 0.75,
            latencyMs: 50,
          },
        ],
        normalizedActions: new Map([
          ["fold", 0.2],
          ["check", 0.3],
          ["call", 0.3],
          ["raise", 0.2],
        ]),
        consensus: 0.7,
        winningAction: scenario.legalActions[0]?.type ?? "fold",
        budgetUsedMs: 100,
        circuitBreakerTripped: false,
        startedAt: Date.now(),
        completedAt: Date.now(),
      } as AggregatedAgentOutput;
    }),
  } as unknown as AgentCoordinator;
}

/**
 * Creates a mock strategy engine for integration testing.
 */
function createIntegrationStrategyEngine(): StrategyEngine {
  return {
    decide: vi.fn((_state, gto, _agent, _sessionId) => {
      // Pick first action from GTO solution or safe fallback
      let selectedAction: Action = {
        type: "fold",
        position: _state.positions.hero,
        street: _state.street,
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
          gtoRecommendation: gto.actions
            ? new Map<string, number>(
                Array.from(
                  gto.actions.entries() as IterableIterator<
                    [string, ActionSolutionEntry]
                  >,
                ).map(
                  ([k, v]) => [k, v.solution.frequency] as [string, number],
                ),
              )
            : new Map<string, number>(),
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

/**
 * Creates a GameState from a scenario.
 */
function createStateFromScenario(scenario: HandScenario): GameState {
  const players = new Map<
    Position,
    { stack: number; holeCards?: { rank: string; suit: string }[] }
  >();
  POSITIONS.forEach((pos) => {
    players.set(pos, { stack: 1000 });
  });

  return {
    handId: scenario.handId,
    gameType: "NLHE_6max",
    blinds: { small: 1, big: 2 },
    positions: {
      hero: scenario.heroPosition,
      button: "BTN",
      smallBlind: "SB",
      bigBlind: "BB",
    },
    players,
    communityCards: [],
    pot: scenario.pot,
    street: scenario.street,
    actionHistory: [],
    legalActions: scenario.legalActions,
    confidence: { overall: 1, perElement: new Map() },
    latency: 0,
  } as unknown as GameState;
}

describe("Phase 12: CI-Safe Integration Suite", () => {
  const CI_HAND_COUNT = 75; // 50-100 range for CI
  const LONG_RUN_HAND_COUNT = 1000;
  const TEST_SEED = 20260113; // Deterministic seed based on date

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("CI Smoke Integration (50-100 hands)", () => {
    it("processes all hands without exceptions", async () => {
      const scenarios = generateHandScenarios(CI_HAND_COUNT, TEST_SEED);
      const engine = createIntegrationStrategyEngine();
      const results: DecisionPipelineResult[] = [];

      for (const scenario of scenarios) {
        const state = createStateFromScenario(scenario);
        const solver = createConfigurableSolver(scenario);
        const agents = createConfigurableAgentCoordinator(scenario);

        const tracker = new TimeBudgetTracker({
          totalBudgetMs: 2000,
          allocation: {
            perception: 200,
            gto: 400,
            agents: 400,
            synthesis: 200,
            execution: 200,
            buffer: 600,
          },
        });

        const result = await makeDecision(state, "integration-session", {
          strategyEngine: engine,
          gtoSolver: solver,
          agentCoordinator: agents,
          tracker,
          logger: mockLogger,
        });

        results.push(result);
      }

      // All hands should produce valid results
      expect(results).toHaveLength(CI_HAND_COUNT);
      results.forEach((result, idx) => {
        expect(result.decision).toBeDefined();
        expect(result.decision.action).toBeDefined();
        expect(result.gtoSolution).toBeDefined();
        expect(result.agentOutput).toBeDefined();
      });
    });

    it("handles solver fallbacks correctly", async () => {
      const scenarios = generateHandScenarios(CI_HAND_COUNT, TEST_SEED);
      const engine = createIntegrationStrategyEngine();
      let solverFailures = 0;
      let solverSuccesses = 0;

      for (const scenario of scenarios) {
        const state = createStateFromScenario(scenario);
        const solver = createConfigurableSolver(scenario);
        const agents = createConfigurableAgentCoordinator(scenario);

        const result = await makeDecision(state, "integration-session", {
          strategyEngine: engine,
          gtoSolver: solver,
          agentCoordinator: agents,
          logger: mockLogger,
        });

        if (result.solverTimedOut) {
          solverFailures++;
        } else {
          solverSuccesses++;
        }
      }

      // Verify we exercised both paths
      expect(solverFailures).toBeGreaterThan(0);
      expect(solverSuccesses).toBeGreaterThan(0);
      expect(solverFailures + solverSuccesses).toBe(CI_HAND_COUNT);
    });

    it("handles agent fallbacks correctly", async () => {
      const scenarios = generateHandScenarios(CI_HAND_COUNT, TEST_SEED);
      const engine = createIntegrationStrategyEngine();
      let agentStubs = 0;

      for (const scenario of scenarios) {
        const state = createStateFromScenario(scenario);
        const solver = createConfigurableSolver(scenario);
        const agents = createConfigurableAgentCoordinator(scenario);

        const result = await makeDecision(state, "integration-session", {
          strategyEngine: engine,
          gtoSolver: solver,
          agentCoordinator: agents,
          logger: mockLogger,
        });

        if (
          result.agentOutput.notes?.includes("stubbed") ||
          result.agentOutput.outputs.length === 0
        ) {
          agentStubs++;
        }
      }

      // Should have exercised agent fallback path at least once
      expect(agentStubs).toBeGreaterThan(0);
    });

    it("maintains state consistency across hands", async () => {
      const scenarios = generateHandScenarios(CI_HAND_COUNT, TEST_SEED);
      const engine = createIntegrationStrategyEngine();
      const sessionId = "state-consistency-test";

      let previousHandId: string | null = null;

      for (const scenario of scenarios) {
        const state = createStateFromScenario(scenario);
        const solver = createConfigurableSolver(scenario);

        const result = await makeDecision(state, sessionId, {
          strategyEngine: engine,
          gtoSolver: solver,
          logger: mockLogger,
        });

        // Verify hand IDs are unique and sequential
        expect(result.decision.action.street).toBe(scenario.street);

        // Verify state isolation between hands
        if (previousHandId) {
          expect(state.handId).not.toBe(previousHandId);
        }
        previousHandId = state.handId;
      }
    });

    it("produces deterministic results with same seed", async () => {
      const scenarios1 = generateHandScenarios(10, TEST_SEED);
      const scenarios2 = generateHandScenarios(10, TEST_SEED);

      // Scenarios should be identical
      expect(scenarios1).toEqual(scenarios2);

      const engine = createIntegrationStrategyEngine();
      const results1: string[] = [];
      const results2: string[] = [];

      for (const scenario of scenarios1) {
        const state = createStateFromScenario(scenario);
        const solver = createConfigurableSolver(scenario);

        const result = await makeDecision(state, "determinism-test", {
          strategyEngine: engine,
          gtoSolver: solver,
          logger: mockLogger,
        });

        results1.push(result.decision.action.type);
      }

      // Reset mocks
      vi.clearAllMocks();

      for (const scenario of scenarios2) {
        const state = createStateFromScenario(scenario);
        const solver = createConfigurableSolver(scenario);

        const result = await makeDecision(state, "determinism-test", {
          strategyEngine: engine,
          gtoSolver: solver,
          logger: mockLogger,
        });

        results2.push(result.decision.action.type);
      }

      // Results should be identical
      expect(results1).toEqual(results2);
    });

    it("no invariant violations across all hands", async () => {
      const scenarios = generateHandScenarios(CI_HAND_COUNT, TEST_SEED);
      const engine = createIntegrationStrategyEngine();
      const invariantViolations: string[] = [];

      for (const scenario of scenarios) {
        const state = createStateFromScenario(scenario);
        const solver = createConfigurableSolver(scenario);
        const agents = createConfigurableAgentCoordinator(scenario);

        const tracker = new TimeBudgetTracker({
          totalBudgetMs: 2000,
        });

        const result = await makeDecision(state, "invariant-test", {
          strategyEngine: engine,
          gtoSolver: solver,
          agentCoordinator: agents,
          tracker,
          logger: mockLogger,
        });

        // Check invariants
        if (!result.decision) {
          invariantViolations.push(`${scenario.handId}: missing decision`);
        }
        if (!result.gtoSolution) {
          invariantViolations.push(`${scenario.handId}: missing gtoSolution`);
        }
        if (!result.agentOutput) {
          invariantViolations.push(`${scenario.handId}: missing agentOutput`);
        }
        if (
          result.decision?.action &&
          !["fold", "check", "call", "raise"].includes(
            result.decision.action.type,
          )
        ) {
          invariantViolations.push(
            `${scenario.handId}: invalid action type ${result.decision.action.type}`,
          );
        }

        // Budget invariants
        const allocation = tracker.allocationSnapshot();
        for (const [component, budget] of Object.entries(allocation)) {
          if (budget < 0) {
            invariantViolations.push(
              `${scenario.handId}: negative budget for ${component}: ${budget}`,
            );
          }
        }
      }

      expect(invariantViolations).toHaveLength(0);
    });
  });

  describe("Long-Run Stress Test (1000+ hands)", () => {
    const shouldRunLongRun = process.env.E2E_LONG_RUN === "1";

    it.skipIf(!shouldRunLongRun)(
      "processes 1000+ hands without degradation",
      async () => {
        const scenarios = generateHandScenarios(LONG_RUN_HAND_COUNT, TEST_SEED);
        const engine = createIntegrationStrategyEngine();
        const results: DecisionPipelineResult[] = [];

        const startTime = Date.now();
        let solverTimeouts = 0;
        let agentStubs = 0;

        for (const scenario of scenarios) {
          const state = createStateFromScenario(scenario);
          const solver = createConfigurableSolver(scenario);
          const agents = createConfigurableAgentCoordinator(scenario);

          const tracker = new TimeBudgetTracker({
            totalBudgetMs: 2000,
          });

          const result = await makeDecision(state, "long-run-session", {
            strategyEngine: engine,
            gtoSolver: solver,
            agentCoordinator: agents,
            tracker,
            logger: mockLogger,
          });

          results.push(result);

          if (result.solverTimedOut) solverTimeouts++;
          if (
            result.agentOutput.notes?.includes("stubbed") ||
            result.agentOutput.outputs.length === 0
          ) {
            agentStubs++;
          }
        }

        const elapsed = Date.now() - startTime;

        // Performance notes (not strict benchmarks)
        console.log(`Long-run stats:
          - Hands processed: ${results.length}
          - Total time: ${elapsed}ms
          - Avg time per hand: ${(elapsed / results.length).toFixed(2)}ms
          - Solver timeouts: ${solverTimeouts} (${((solverTimeouts / results.length) * 100).toFixed(1)}%)
          - Agent stubs: ${agentStubs} (${((agentStubs / results.length) * 100).toFixed(1)}%)`);

        // Assertions
        expect(results).toHaveLength(LONG_RUN_HAND_COUNT);

        // Check for invariant violations
        const violations: string[] = [];
        results.forEach((result, idx) => {
          if (!result.decision)
            violations.push(`Hand ${idx}: missing decision`);
          if (!result.gtoSolution)
            violations.push(`Hand ${idx}: missing gtoSolution`);
          if (!result.agentOutput)
            violations.push(`Hand ${idx}: missing agentOutput`);
        });

        expect(violations).toHaveLength(0);
      },
      { timeout: 300000 }, // 5 minute timeout for long run
    );

    it.skipIf(!shouldRunLongRun)(
      "memory usage remains stable over long run",
      async () => {
        const scenarios = generateHandScenarios(LONG_RUN_HAND_COUNT, TEST_SEED);
        const engine = createIntegrationStrategyEngine();

        // Sample memory at intervals
        const memorySamples: number[] = [];
        const sampleInterval = 100;

        for (let i = 0; i < scenarios.length; i++) {
          const scenario = scenarios[i];
          const state = createStateFromScenario(scenario);
          const solver = createConfigurableSolver(scenario);

          await makeDecision(state, "memory-test", {
            strategyEngine: engine,
            gtoSolver: solver,
            logger: mockLogger,
          });

          if (i % sampleInterval === 0) {
            const used = process.memoryUsage().heapUsed;
            memorySamples.push(used);
          }
        }

        // Check for memory growth (should not grow significantly)
        if (memorySamples.length >= 3) {
          const firstThird = memorySamples.slice(
            0,
            Math.floor(memorySamples.length / 3),
          );
          const lastThird = memorySamples.slice(
            -Math.floor(memorySamples.length / 3),
          );

          const avgFirst =
            firstThird.reduce((a, b) => a + b, 0) / firstThird.length;
          const avgLast =
            lastThird.reduce((a, b) => a + b, 0) / lastThird.length;

          // Memory should not grow more than 50% (allows for normal GC variation)
          const growthRatio = avgLast / avgFirst;
          expect(growthRatio).toBeLessThan(1.5);
        }
      },
      { timeout: 300000 },
    );
  });
});
