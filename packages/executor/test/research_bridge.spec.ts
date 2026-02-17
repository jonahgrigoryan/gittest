import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResearchUIExecutor } from "../src/research_bridge";
import { WindowManager } from "../src/window_manager";
import { ComplianceChecker } from "../src/compliance";
import type { StrategyDecision } from "@poker-bot/shared";
import type { ActionVerifier } from "../src/verifier";

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
  let mockInputAutomation: any;
  let mockBetInputHandler: any;

  const createExecutor = (verifier?: ActionVerifier) =>
    new ResearchUIExecutor(
      mockWindowManager as WindowManager,
      mockComplianceChecker as ComplianceChecker,
      verifier,
      mockResearchUIConfig,
      console,
      {
        inputAutomation: mockInputAutomation,
        betInputHandler: mockBetInputHandler
      }
    );

  beforeEach(() => {
    mockWindowManager = {
      findPokerWindow: vi.fn().mockResolvedValue({ id: 1, processName: "poker", title: "Table 1" }),
      getWindowBounds: vi.fn().mockResolvedValue({ x: 0, y: 0, width: 800, height: 600 }),
      validateWindow: vi.fn().mockReturnValue(true),
      focusWindow: vi.fn().mockResolvedValue(true)
    };

    mockComplianceChecker = {
      validateExecution: vi.fn().mockResolvedValue(true)
    };

    mockVerifier = {
      verifyAction: vi.fn().mockResolvedValue({ passed: true })
    };

    mockInputAutomation = {
      clickAt: vi.fn().mockResolvedValue(undefined),
      clickScreenCoords: vi.fn().mockResolvedValue(undefined),
      typeText: vi.fn().mockResolvedValue(undefined),
      clearTextField: vi.fn().mockResolvedValue(undefined),
      updateCoordinateContext: vi.fn(),
      updateRandomSeed: vi.fn()
    };
    mockBetInputHandler = {
      inputBetAmount: vi.fn().mockResolvedValue(undefined)
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Phase 10: Executor Error Paths", () => {
    // Scenario 1: Compliance check failing
    it("Scenario 1: halts execution when compliance checker blocks", async () => {
      mockComplianceChecker.validateExecution.mockResolvedValue(false);

      const executor = createExecutor();

      const result = await executor.execute(baseDecision, { verifyAction: false });

      expect(mockComplianceChecker.validateExecution).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain("Compliance check failed");
      expect(mockWindowManager.findPokerWindow).not.toHaveBeenCalled();
    });

    // Scenario 2: Window manager returning null
    it("Scenario 2: fails fast when window manager returns null", async () => {
      mockWindowManager.findPokerWindow.mockResolvedValue(null);

      const executor = createExecutor();

      const result = await executor.execute(baseDecision, { verifyAction: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Poker window not found");
      expect(mockWindowManager.focusWindow).not.toHaveBeenCalled();
    });

    // Scenario 3: Vision timeout (mocking turn state check failure)
    it("Scenario 3: handles vision/turn state failure", async () => {
      const executor = createExecutor();

      // Mock private method getCurrentTurnState to throw timeout error
      vi.spyOn(executor as any, "getCurrentTurnState").mockRejectedValue(new Error("Vision timeout"));

      const result = await executor.execute(baseDecision, { verifyAction: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Vision timeout");
    });

    // Scenario 4: Bet sizing failure
    it("Scenario 4: surfaces bet sizing failures", async () => {
      const executor = createExecutor();

      // Stub delay to avoid real sleeps (deterministic)
      vi.spyOn(executor as any, "delay").mockResolvedValue(undefined);

      mockBetInputHandler.inputBetAmount.mockRejectedValue(new Error("Invalid bet size calculation"));

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

      const executor = createExecutor(mockVerifier as ActionVerifier);

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

      const executor = createExecutor();

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

      const executor = createExecutor();

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

      const executor = createExecutor();

      const result = await executor.execute(infDecision, { verifyAction: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid raise amount");
      expect(mockComplianceChecker.validateExecution).not.toHaveBeenCalled();
    });

    it("Task 2.5: focuses window before action execution", async () => {
      const executor = createExecutor();

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

      const executor = createExecutor();

      const performActionSpy = vi.spyOn(executor as any, "performAction");
      const result = await executor.execute(baseDecision, { verifyAction: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to focus window");
      expect(performActionSpy).not.toHaveBeenCalled();
    });

    it("Task 4: raise flow calls BetInputHandler before InputAutomation action click", async () => {
      const executor = createExecutor();
      const actionButton = {
        screenCoords: { x: 412, y: 598 },
        isEnabled: true,
        isVisible: true,
        confidence: 0.99
      };
      vi.spyOn(executor as any, "getCurrentTurnState").mockResolvedValue({
        isHeroTurn: true,
        actionTimer: 12,
        confidence: 0.95
      });
      vi.spyOn(executor as any, "findActionButton").mockResolvedValue(actionButton);

      const result = await executor.execute(baseDecision, { verifyAction: false });
      const betInputMock = mockBetInputHandler.inputBetAmount;

      expect(result.success).toBe(true);
      expect(betInputMock).toHaveBeenCalledTimes(1);
      expect(mockInputAutomation.clickScreenCoords).toHaveBeenCalledWith(
        actionButton.screenCoords.x,
        actionButton.screenCoords.y
      );

      const betInputOrder = betInputMock.mock.invocationCallOrder[0];
      const buttonClickOrder = mockInputAutomation.clickScreenCoords.mock.invocationCallOrder[0];
      expect(betInputOrder).toBeLessThan(buttonClickOrder);
    });

    it("Task 4: updates coordinate context from discovered window bounds", async () => {
      mockWindowManager.getWindowBounds.mockResolvedValue({
        x: 200,
        y: 120,
        width: 1400,
        height: 900
      });
      const executor = createExecutor();
      vi.spyOn(executor as any, "getCurrentTurnState").mockResolvedValue({
        isHeroTurn: true,
        confidence: 0.99
      });
      vi.spyOn(executor as any, "findActionButton").mockResolvedValue({
        screenCoords: { x: 200, y: 300 },
        isEnabled: true,
        isVisible: true,
        confidence: 0.9
      });

      const result = await executor.execute(
        {
          ...baseDecision,
          action: { ...baseDecision.action, type: "call" }
        },
        { verifyAction: false }
      );

      expect(result.success).toBe(true);
      expect(mockInputAutomation.updateCoordinateContext).toHaveBeenCalled();
      expect(mockInputAutomation.updateCoordinateContext).toHaveBeenCalledWith({
        dpiCalibration: 1,
        layoutResolution: { width: 1920, height: 1080 },
        windowBounds: { x: 200, y: 120, width: 1400, height: 900 }
      });
      expect(mockInputAutomation.updateRandomSeed).toHaveBeenCalledWith(baseDecision.metadata?.rngSeed);
    });

    it("Task 4: executor does not add duplicate click delay outside InputAutomation", async () => {
      const executor = createExecutor();
      const delaySpy = vi.spyOn(executor as any, "delay");
      vi.spyOn(executor as any, "getCurrentTurnState").mockResolvedValue({
        isHeroTurn: true,
        confidence: 0.99
      });
      vi.spyOn(executor as any, "findActionButton").mockResolvedValue({
        screenCoords: { x: 80, y: 120 },
        isEnabled: true,
        isVisible: true,
        confidence: 0.95
      });

      const result = await executor.execute(
        {
          ...baseDecision,
          action: { ...baseDecision.action, type: "fold", amount: undefined }
        },
        { verifyAction: false }
      );

      expect(result.success).toBe(true);
      expect(delaySpy).not.toHaveBeenCalled();
    });

    it("refreshes window bounds after focus before updating coordinate context", async () => {
      mockWindowManager.getWindowBounds
        .mockResolvedValueOnce({ x: 0, y: 0, width: 800, height: 600 })
        .mockResolvedValueOnce({ x: 120, y: 80, width: 1000, height: 700 });

      const executor = createExecutor();
      vi.spyOn(executor as any, "getCurrentTurnState").mockResolvedValue({
        isHeroTurn: true,
        confidence: 0.99
      });
      vi.spyOn(executor as any, "findActionButton").mockResolvedValue({
        screenCoords: { x: 250, y: 350 },
        isEnabled: true,
        isVisible: true,
        confidence: 0.95
      });

      const result = await executor.execute(
        {
          ...baseDecision,
          action: { ...baseDecision.action, type: "call", amount: undefined }
        },
        { verifyAction: false }
      );

      expect(result.success).toBe(true);
      expect(mockWindowManager.getWindowBounds).toHaveBeenCalledTimes(2);
      expect(mockInputAutomation.updateCoordinateContext).toHaveBeenCalledWith({
        dpiCalibration: 1,
        layoutResolution: { width: 1920, height: 1080 },
        windowBounds: { x: 120, y: 80, width: 1000, height: 700 }
      });
    });
  });
});
