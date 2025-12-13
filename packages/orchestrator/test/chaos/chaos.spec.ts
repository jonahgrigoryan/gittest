import { describe, it, expect, vi } from "vitest";
import type {
  Action,
  GameState,
  GTOSolution,
  ConfigurationManager
} from "@poker-bot/shared";
import { createActionKey } from "@poker-bot/shared";
import type { AgentCoordinator, AggregatedAgentOutput } from "@poker-bot/agents";
import { StrategyEngine } from "../../src/strategy/engine";
import type { StrategyConfig } from "../../src/strategy/types";
import type { RiskGuardAPI, RiskSnapshot } from "../../src/safety/types";
import { makeDecision, createStubAgentOutput } from "../../src/decision/pipeline";
import { TimeBudgetTracker } from "../../src/budget/timeBudgetTracker";
import { SafeModeController } from "../../src/health/safeModeController";
import { PanicStopController } from "../../src/health/panicStopController";
import { HealthMetricsStore } from "../../src/health/metricsStore";
import { HealthMonitor } from "../../src/health/monitor";
import type { HealthMonitoringConfig } from "@poker-bot/shared";
import { ActionVerifier } from "@poker-bot/executor";
import type { ExecutionResult, VisionClientInterface } from "@poker-bot/executor";
import { GTOSolver } from "../../src/solver/solver";

function baseStrategyConfig(): StrategyConfig {
  return {
    alphaGTO: 0.6,
    betSizingSets: {
      preflop: [0.5, 1.0],
      flop: [0.33, 0.5, 0.75, 1.0],
      turn: [0.5, 1.0],
      river: [0.5, 1.0]
    },
    divergenceThresholdPP: 30
  };
}

function createRiskController(allowed = true): RiskGuardAPI {
  const snapshot: RiskSnapshot = {
    netProfit: 0,
    drawdown: 0,
    handsPlayed: 0,
    remainingHands: 100,
    remainingBankroll: 1000,
    liveExposure: 0,
    panicStop: !allowed,
    updatedAt: Date.now()
  };
  return {
    startHand: vi.fn(),
    incrementHandCount: vi.fn(() => 1),
    recordOutcome: vi.fn(() => snapshot),
    updateLimits: vi.fn(() => snapshot),
    resetSession: vi.fn(),
    getSnapshot: vi.fn(() => snapshot),
    checkLimits: vi.fn(() => ({
      allowed,
      snapshot
    }))
  } as unknown as RiskGuardAPI;
}

function createState(overrides: Partial<GameState> = {}): GameState {
  const base: GameState = {
    handId: "chaos-hand",
    gameType: "NLHE_6max",
    blinds: { small: 1, big: 2 },
    positions: {
      hero: "BTN",
      button: "BTN",
      smallBlind: "SB",
      bigBlind: "BB"
    },
    players: new Map([
      ["BTN", { stack: 100 }],
      ["SB", { stack: 100 }],
      ["BB", { stack: 100 }]
    ]),
    communityCards: [],
    pot: 3,
    street: "flop",
    actionHistory: [],
    legalActions: [
      { type: "check", position: "BTN", street: "flop" } as Action,
      { type: "call", position: "BTN", street: "flop", amount: 5 } as Action,
      { type: "fold", position: "BTN", street: "flop" } as Action
    ],
    confidence: { overall: 1, perElement: new Map() },
    latency: 0
  };
  return {
    ...base,
    ...overrides,
    players: overrides.players ?? base.players,
    legalActions: overrides.legalActions ?? base.legalActions,
    actionHistory: overrides.actionHistory ?? base.actionHistory
  };
}

function createGtoSolution(action: Action): GTOSolution {
  const entry = {
    action,
    solution: { frequency: 1, ev: 0 }
  };
  return {
    actions: new Map([[createActionKey(action), entry]]),
    exploitability: 0,
    computeTime: 0,
    source: "subgame"
  };
}

function createStrategyEngine(allowed = true): StrategyEngine {
  return new StrategyEngine(baseStrategyConfig(), createRiskController(allowed), {
    timeBudgetTracker: new TimeBudgetTracker({ totalBudgetMs: 500 }),
    logger: console
  });
}

describe("Chaos engineering drills", () => {
  it("triggers panic stop after consecutive low-confidence frames", () => {
    const safeMode = new SafeModeController({ warn: () => { }, info: () => { } });
    const panic = new PanicStopController(safeMode, { warn: () => { }, error: () => { } });
    const metrics = new HealthMetricsStore(
      { visionConfidenceFrames: 3, minConfidence: 0.99 },
      detail =>
        panic.trigger({
          type: "vision_confidence",
          detail,
          triggeredAt: Date.now()
        })
    );

    metrics.recordVisionSample(0.5, Date.now());
    metrics.recordVisionSample(0.4, Date.now() + 1);
    metrics.recordVisionSample(0.3, Date.now() + 2);

    expect(panic.isActive()).toBe(true);
    expect(safeMode.isActive()).toBe(true);
    expect(panic.getReason()?.type).toBe("vision_confidence");
  });

  it("falls back to safe action when solver throws during network partition", async () => {
    const state = createState();
    const strategyEngine = createStrategyEngine();
    const failingSolver = {
      solve: vi.fn(async () => {
        throw new Error("network unreachable");
      })
    };

    const tracker = {
      shouldPreempt: vi.fn(() => false),
      remaining: vi.fn(() => 100),
      reserve: vi.fn(() => true),
      startComponent: vi.fn(),
      endComponent: vi.fn(() => 0),
      release: vi.fn()
    } as unknown as TimeBudgetTracker;

    const result = await makeDecision(state, "session-chaos", {
      strategyEngine,
      gtoSolver: failingSolver as any,
      tracker,
      logger: console
    });

    expect(result.solverTimedOut).toBe(true);
    expect(result.decision.action.type === "check" || result.decision.action.type === "call").toBe(
      true
    );
  });

  it("uses GTO-only fallback when agent coordinator fails", async () => {
    const state = createState();
    const strategyEngine = createStrategyEngine();
    const gtoSolution = createGtoSolution(state.legalActions[1]!);
    const gtoSolver = {
      solve: vi.fn(async () => gtoSolution)
    };
    const failingAgents: AgentCoordinator = {
      query: vi.fn(async () => {
        throw new Error("LLM JSON invalid");
      })
    } as unknown as AgentCoordinator;

    const result = await makeDecision(state, "session-chaos", {
      strategyEngine,
      gtoSolver: gtoSolver as any,
      agentCoordinator: failingAgents,
      logger: console
    });

    expect(failingAgents.query).toHaveBeenCalled();
    expect(result.agentOutput.outputs.length).toBe(0);
    expect(result.decision.metadata.usedGtoOnlyFallback).toBe(true);
  });

  it("preempts GTO budget and falls back to safe action during component restart", async () => {
    const state = {
      ...createState(),
      legalActions: [] // force safe action fallback when GTO distribution is empty
    };
    const strategyEngine = createStrategyEngine();
    const emptySolution: GTOSolution = {
      actions: new Map(),
      exploitability: 0,
      computeTime: 0,
      source: "subgame"
    };
    const gtoSolver = {
      solve: vi.fn(async (_state: GameState, budgetMs: number) => {
        expect(budgetMs).toBe(0);
        return emptySolution;
      })
    };
    const tracker = {
      shouldPreempt: vi.fn((component: string) => component === "gto"),
      remaining: vi.fn(() => 0),
      reserve: vi.fn(() => false),
      startComponent: vi.fn(),
      endComponent: vi.fn(() => 0),
      release: vi.fn()
    } as unknown as TimeBudgetTracker;

    const result = await makeDecision(state, "session-chaos", {
      strategyEngine,
      gtoSolver: gtoSolver as any,
      tracker
    });

    expect(result.solverTimedOut).toBe(true);
    expect(result.decision.reasoning.fallbackReason).toMatch(/safe_action|gto_/);
  });

  it("flags executor misfires via ActionVerifier", async () => {
    const visionClient: VisionClientInterface = {
      captureAndParse: vi.fn(async () => ({
        confidence: { overall: 0.4 }
      }))
    };
    const verifier = new ActionVerifier(visionClient, {
      debug: () => { },
      info: () => { },
      warn: () => { },
      error: () => { }
    });

    const result = await verifier.verifyAction(
      { type: "raise", position: "BTN", street: "flop", amount: 20 } as Action,
      []
    );
    expect(result.passed).toBe(false);
    expect(result.mismatchReason).toBeDefined();

    const retried = await verifier.retryOnMismatch(
      { verificationResult: result } as ExecutionResult,
      1
    );
    expect(retried.verificationResult?.retryCount).toBe(1);
  });

  it("supports recovery run after panic stop reset", async () => {
    const safeMode = new SafeModeController({ warn: () => { }, info: () => { } });
    const panic = new PanicStopController(safeMode, { warn: () => { }, error: () => { } });
    panic.trigger({
      type: "vision_confidence",
      detail: "drill",
      triggeredAt: Date.now()
    });

    expect(panic.isActive()).toBe(true);
    expect(safeMode.isActive()).toBe(true);

    panic.reset();
    safeMode.exit();

    const config: HealthMonitoringConfig = {
      intervalMs: 10,
      degradedThresholds: {
        visionConfidenceMin: 0.9,
        solverLatencyMs: 500,
        executorFailureRate: 0.5
      },
      safeMode: { enabled: true, autoExitSeconds: 1 },
      panicStop: {
        visionConfidenceFrames: 3,
        minConfidence: 0.99,
        riskGuardAutoTrip: true
      },
      dashboard: { enabled: false, port: 7777 }
    };

    const monitor = new HealthMonitor(config, { safeMode, panicStop: panic });
    monitor.registerCheck({
      name: "vision",
      fn: async () => ({
        component: "vision",
        state: "healthy",
        checkedAt: Date.now(),
        consecutiveFailures: 0
      })
    });
    monitor.start();
    await new Promise(resolve => setTimeout(resolve, config.intervalMs * 2));
    monitor.stop();

    expect(panic.isActive()).toBe(false);
    expect(safeMode.isActive()).toBe(false);
  });

  it("detects resource exhaustion via TimeBudgetTracker", () => {
    let now = 0;
    const tracker = new TimeBudgetTracker({
      totalBudgetMs: 50,
      allocation: { gto: 10 } as any,
      now: () => now
    });

    tracker.start();
    tracker.startComponent("gto");
    now = 25;
    tracker.endComponent("gto");

    expect(tracker.shouldPreempt("gto")).toBe(true);
  });

  it("continues decision flow after cache wipe and solver failure", async () => {
    const state = createState();
    const cacheLoader = {
      queryCache: vi.fn(() => {
        throw new Error("cache corrupt");
      }),
      queryApproximate: vi.fn(() => undefined)
    };
    const solverClient = {
      solve: vi.fn(async () => {
        throw new Error("solver offline");
      }),
      close: vi.fn()
    };
    const configManager = {
      get: vi.fn((key: string) => {
        if (key === "gto.subgameBudgetMs") {
          return 50;
        }
        if (key === "gto.deepStackThreshold") {
          return 100;
        }
        return 0;
      })
    } as unknown as ConfigurationManager;
    const solver = new GTOSolver(
      configManager,
      {
        cacheLoader: cacheLoader as any,
        solverClient: solverClient as any
      },
      { logger: { debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } }
    );

    const result = await solver.solve(state, 10);
    const entries = [...result.actions.values()];
    expect(entries.length).toBe(1);
    expect(entries[0]!.action.type === "check" || entries[0]!.action.type === "call").toBe(true);
  });

  it("produces non-stub agent output when coordinator is wired with mock transport", async () => {
    const state = createState();
    const strategyEngine = createStrategyEngine();
    const gtoSolution = createGtoSolution(state.legalActions[0]!);
    const gtoSolver = {
      solve: vi.fn(async () => gtoSolution)
    };

    // Create a mock agent coordinator that returns real output
    const now = Date.now();
    const mockAgentOutput: AggregatedAgentOutput = {
      outputs: [{
        agentId: "test-agent",
        personaId: "gto_purist",
        reasoning: "Mock reasoning for test",
        action: "call",
        confidence: 0.7,
        latencyMs: 50,
        tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        metadata: { weight: 1 }
      }],
      normalizedActions: new Map([["call", 1]]),
      consensus: 0.7,
      winningAction: "call",
      budgetUsedMs: 50,
      circuitBreakerTripped: false,
      droppedAgents: [],
      costSummary: { totalTokens: 150, promptTokens: 100, completionTokens: 50 },
      startedAt: now,
      completedAt: now + 50
    };

    const workingAgents: AgentCoordinator = {
      query: vi.fn(async () => mockAgentOutput)
    } as unknown as AgentCoordinator;

    const result = await makeDecision(state, "session-agent-wiring", {
      strategyEngine,
      gtoSolver: gtoSolver as any,
      agentCoordinator: workingAgents,
      logger: console
    });

    expect(workingAgents.query).toHaveBeenCalled();
    expect(result.agentOutput.outputs.length).toBeGreaterThan(0);
    // notes should be undefined or not contain "stubbed"
    expect(result.agentOutput.notes ?? "").not.toContain("stubbed");
    expect(result.agentOutput.budgetUsedMs).toBeGreaterThan(0);
  });

  it("fails when stub output is used but agents were expected", async () => {
    const state = createState();
    const strategyEngine = createStrategyEngine();
    const gtoSolution = createGtoSolution(state.legalActions[0]!);
    const gtoSolver = {
      solve: vi.fn(async () => gtoSolution)
    };

    // No agent coordinator provided - should produce stub output
    const result = await makeDecision(state, "session-no-agents", {
      strategyEngine,
      gtoSolver: gtoSolver as any,
      logger: console
    });

    // Verify stub output characteristics
    expect(result.agentOutput.outputs.length).toBe(0);
    expect(result.agentOutput.notes).toContain("stubbed");
    expect(result.agentOutput.budgetUsedMs).toBe(0);
  });
});

