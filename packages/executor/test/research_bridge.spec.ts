import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResearchUIExecutor } from "../src/research_bridge";
import { WindowManager } from "../src/window_manager";
import { ComplianceChecker } from "../src/compliance";
import type { StrategyDecision } from "@poker-bot/shared";
import type { ActionVerifier } from "../src/verifier";

// Mock BetInputHandler
vi.mock("../src/bet_input_handler", () => {
  return {
    BetInputHandler: vi.fn().mockImplementation(() => ({
      inputBetAmount: vi.fn().mockResolvedValue(undefined)
    }))
  };
});

import { BetInputHandler } from "../src/bet_input_handler";

const baseDecision: StrategyDecision = {
  action: {
    type: "raise",
    amount: 50,
    position: "BTN",
    street: "flop"
  },
  reasoning: {
    gtoRecommendation: new Map(),
    agentRecommendation: new Map(),
    blendedDistribution: new Map(),
    alpha: 0.7,
    divergence: 0,
    riskCheckPassed: true,
    sizingQuantized: false
  },
  timing: {
    gtoTime: 0,
    agentTime: 0,
    synthesisTime: 0,
    totalTime: 0
  },
  metadata: {
    rngSeed: 1,
    configSnapshot: {
      alphaGTO: 0.7,
      betSizingSets: {
        preflop: [0.5],
        flop: [0.5],
        turn: [0.5],
        river: [0.5]
      },
      divergenceThresholdPP: 30
    }
  }
};

const mockResearchUIConfig = {
  allowlist: ["CoinPoker"],
  prohibitedSites: ["pokerstars.com"],
  requireBuildFlag: true,
  betInputField: {
    x: 100,
    y: 200,
    width: 150,
    height: 30,
    decimalPrecision: 2,
    decimalSeparator: "." as const
  },
  minRaiseAmount: 2
};

describe("ResearchUIExecutor", () => {
  let mockWindowManager: any;
  let mockComplianceChecker: any;
  let mockVerifier: any;

  beforeEach(() => {
    mockWindowManager = {
      findPokerWindow: vi.fn().mockResolvedValue({ id: 1, processName: "poker", title: "Table 1" }),
      getWindowBounds: vi.fn().mockResolvedValue({ x: 0, y: 0, width: 800, height: 600 }),
      validateWindow: vi.fn().mockReturnValue(true),
      focusWindow: vi.fn().mockResolvedValue(true),
      buttonToScreenCoords: vi.fn().mockReturnValue({ x: 100, y: 100 })
    };

    mockComplianceChecker = {
      validateExecution: vi.fn().mockResolvedValue(true)
    };

    mockVerifier = {
      verifyAction: vi.fn().mockResolvedValue({ passed: true })
    };

    // Reset BetInputHandler mock
    (BetInputHandler as any).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Phase 10: Executor Error Paths", () => {
    // Scenario 1: Compliance check failing
    it("Scenario 1: halts execution when compliance checker blocks", async () => {
      mockComplianceChecker.validateExecution.mockResolvedValue(false);

      const executor = new ResearchUIExecutor(
        mockWindowManager as WindowManager, 
        mockComplianceChecker as ComplianceChecker, 
        undefined, 
        mockResearchUIConfig,
        console
      );

      const result = await executor.execute(baseDecision, { verifyAction: false });

      expect(mockComplianceChecker.validateExecution).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain("Compliance check failed");
      expect(mockWindowManager.findPokerWindow).not.toHaveBeenCalled();
    });

    // Scenario 2: Window manager returning null
    it("Scenario 2: fails fast when window manager returns null", async () => {
      mockWindowManager.findPokerWindow.mockResolvedValue(null);

      const executor = new ResearchUIExecutor(
        mockWindowManager as WindowManager, 
        mockComplianceChecker as ComplianceChecker, 
        undefined, 
        mockResearchUIConfig,
        console
      );

      const result = await executor.execute(baseDecision, { verifyAction: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Poker window not found");
      expect(mockWindowManager.focusWindow).not.toHaveBeenCalled();
    });

    // Scenario 3: Vision timeout (mocking turn state check failure)
    it("Scenario 3: handles vision/turn state failure", async () => {
      const executor = new ResearchUIExecutor(
        mockWindowManager as WindowManager, 
        mockComplianceChecker as ComplianceChecker, 
        undefined, 
        mockResearchUIConfig,
        console
      );

      // Mock private method getCurrentTurnState to throw timeout error
      vi.spyOn(executor as any, "getCurrentTurnState").mockRejectedValue(new Error("Vision timeout"));

      const result = await executor.execute(baseDecision, { verifyAction: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Vision timeout");
    });

    // Scenario 4: Bet sizing failure
    it("Scenario 4: surfaces bet sizing failures", async () => {
      const executor = new ResearchUIExecutor(
        mockWindowManager as WindowManager, 
        mockComplianceChecker as ComplianceChecker, 
        undefined, 
        mockResearchUIConfig,
        console
      );

      // Stub delay to avoid real sleeps (deterministic)
      vi.spyOn(executor as any, "delay").mockResolvedValue(undefined);

      // Mock BetInputHandler instance to throw error
      // We need to access the instance property directly to mock the method on the specific instance
      (executor as any).betInputHandler.inputBetAmount = vi.fn().mockRejectedValue(new Error("Invalid bet size calculation"));

      const result = await executor.execute(baseDecision, { verifyAction: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Action execution failed");
      expect(result.error).toContain("Invalid bet size calculation");
    });

    // Scenario 5: Retry logic reaching max retries
    it("Scenario 5: retries verification exactly maxRetries times then fails", async () => {
      mockVerifier.verifyAction.mockResolvedValue({
        passed: false,
        mismatchReason: "OCR mismatch"
      });

      const executor = new ResearchUIExecutor(
        mockWindowManager as WindowManager, 
        mockComplianceChecker as ComplianceChecker, 
        mockVerifier as ActionVerifier, 
        mockResearchUIConfig,
        console
      );

      // Stub delay to avoid real sleeps (deterministic)
      vi.spyOn(executor as any, "delay").mockResolvedValue(undefined);

      // Mock internal methods to avoid full execution overhead/delays during retries
      vi.spyOn(executor as any, "performAction").mockResolvedValue({
        success: true,
        actionExecuted: baseDecision.action,
        verificationResult: undefined
      });
      vi.spyOn(executor as any, "getCurrentTurnState").mockResolvedValue({ isHeroTurn: true });
      vi.spyOn(executor as any, "findActionButton").mockResolvedValue({ screenCoords: {x:0,y:0} });

      const result = await executor.execute(baseDecision, { 
        verifyAction: true, 
        maxRetries: 2,
        timeoutMs: 5000
      });

      // Initial + 2 retries = 3 executions
      // Note: performAction is called 3 times
      expect((executor as any).performAction).toHaveBeenCalledTimes(3);
      expect(mockVerifier.verifyAction).toHaveBeenCalledTimes(3);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Verification failed");
    });

    // Scenario 6: Action amount validation for raises
    it("Scenario 6: rejects invalid raise amounts early", async () => {
      const invalidDecision = { 
        ...baseDecision, 
        action: { ...baseDecision.action, amount: -50 } 
      };

      const executor = new ResearchUIExecutor(
        mockWindowManager as WindowManager, 
        mockComplianceChecker as ComplianceChecker, 
        undefined, 
        mockResearchUIConfig,
        console
      );

      const result = await executor.execute(invalidDecision, { verifyAction: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid raise amount");
      expect(mockComplianceChecker.validateExecution).not.toHaveBeenCalled();
    });

    // Scenario 6b: NaN raise amount validation
    it("Scenario 6b: rejects NaN raise amounts", async () => {
      const nanDecision = { 
        ...baseDecision, 
        action: { ...baseDecision.action, amount: NaN } 
      };

      const executor = new ResearchUIExecutor(
        mockWindowManager as WindowManager, 
        mockComplianceChecker as ComplianceChecker, 
        undefined, 
        mockResearchUIConfig,
        console
      );

      const result = await executor.execute(nanDecision, { verifyAction: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid raise amount");
      expect(mockComplianceChecker.validateExecution).not.toHaveBeenCalled();
    });

    // Scenario 6c: Infinity raise amount validation
    it("Scenario 6c: rejects Infinity raise amounts", async () => {
      const infDecision = { 
        ...baseDecision, 
        action: { ...baseDecision.action, amount: Infinity } 
      };

      const executor = new ResearchUIExecutor(
        mockWindowManager as WindowManager, 
        mockComplianceChecker as ComplianceChecker, 
        undefined, 
        mockResearchUIConfig,
        console
      );

      const result = await executor.execute(infDecision, { verifyAction: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid raise amount");
      expect(mockComplianceChecker.validateExecution).not.toHaveBeenCalled();
    });

    it("Task 2.5: focuses window before action execution", async () => {
      const executor = new ResearchUIExecutor(
        mockWindowManager as WindowManager,
        mockComplianceChecker as ComplianceChecker,
        undefined,
        mockResearchUIConfig,
        console
      );

      const performActionSpy = vi.spyOn(executor as any, "performAction").mockResolvedValue({
        success: true,
        actionExecuted: baseDecision.action,
        timing: {
          executionMs: 0,
          totalMs: 0
        },
        metadata: {
          executionMode: "research-ui",
          platform: "poker",
          windowHandle: "1"
        }
      });

      vi.spyOn(executor as any, "getCurrentTurnState").mockResolvedValue({
        isHeroTurn: true,
        actionTimer: 20,
        confidence: 0.99
      });
      vi.spyOn(executor as any, "findActionButton").mockResolvedValue({
        screenCoords: { x: 250, y: 420 },
        isEnabled: true,
        isVisible: true,
        confidence: 0.95
      });

      const result = await executor.execute(baseDecision, { verifyAction: false });

      expect(result.success).toBe(true);
      expect(mockWindowManager.focusWindow).toHaveBeenCalledTimes(1);
      expect(performActionSpy).toHaveBeenCalledTimes(1);

      const focusInvocationOrder = mockWindowManager.focusWindow.mock.invocationCallOrder[0];
      const performActionInvocationOrder = performActionSpy.mock.invocationCallOrder[0];
      expect(focusInvocationOrder).toBeLessThan(performActionInvocationOrder);
    });

    it("Task 2.5: returns failure when focus operation fails", async () => {
      mockWindowManager.focusWindow.mockResolvedValue(false);

      const executor = new ResearchUIExecutor(
        mockWindowManager as WindowManager,
        mockComplianceChecker as ComplianceChecker,
        undefined,
        mockResearchUIConfig,
        console
      );

      const performActionSpy = vi.spyOn(executor as any, "performAction");
      const result = await executor.execute(baseDecision, { verifyAction: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to focus window");
      expect(performActionSpy).not.toHaveBeenCalled();
    });
  });
});
