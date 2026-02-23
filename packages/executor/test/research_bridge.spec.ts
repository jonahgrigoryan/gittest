import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { ResearchUIExecutor } from "../src/research_bridge";
import { WindowManager } from "../src/window_manager";
import { ComplianceChecker } from "../src/compliance";
import type { StrategyDecision } from "@poker-bot/shared";
import type {
  ActionVerifier,
  VisionClientInterface,
  VisionOutput,
} from "../src/verifier";

type MockLogger = Pick<Console, "debug" | "info" | "warn" | "error">;

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

const baselineVisionButton = {
  screenCoords: { x: 250, y: 350 },
  isEnabled: true,
  isVisible: true,
  confidence: 0.95
};

describe("ResearchUIExecutor", () => {
  let mockWindowManager: any;
  let mockComplianceChecker: any;
  let mockVerifier: any;
  let mockInputAutomation: any;
  let mockBetInputHandler: any;
  let mockVisionClient: any;
  let mockLogger: MockLogger;

  const defaultVisionSnapshot: VisionOutput = {
    confidence: { overall: 0.99 },
    turnState: {
      isHeroTurn: true,
      actionTimer: 20,
      confidence: 0.99
    },
    actionButtons: {
      fold: baselineVisionButton,
      check: baselineVisionButton,
      call: baselineVisionButton,
      raise: baselineVisionButton,
      bet: baselineVisionButton,
      allIn: baselineVisionButton
    }
  };

const createExecutor = (verifier?: ActionVerifier, logger: MockLogger = mockLogger, visionClient?: VisionClientInterface) =>
  new ResearchUIExecutor(
    mockWindowManager as WindowManager,
    mockComplianceChecker as ComplianceChecker,
    verifier,
    mockResearchUIConfig,
    logger,
    {
      inputAutomation: mockInputAutomation,
      betInputHandler: mockBetInputHandler,
      visionClient: visionClient ?? mockVisionClient,
    },
  );

const createExecutorWithOverrides = (
  verifier?: ActionVerifier,
  logger: MockLogger = mockLogger,
  visionClient?: VisionClientInterface,
  dependencyOverrides: {
    layoutResolution?: { width: number; height: number };
    dpiCalibration?: number;
    inputAutomation?: typeof mockInputAutomation;
    betInputHandler?: typeof mockBetInputHandler;
  } = {},
) =>
  new ResearchUIExecutor(
    mockWindowManager as WindowManager,
    mockComplianceChecker as ComplianceChecker,
    verifier,
    mockResearchUIConfig,
    logger,
    {
      inputAutomation: dependencyOverrides.inputAutomation ?? mockInputAutomation,
      betInputHandler: dependencyOverrides.betInputHandler ?? mockBetInputHandler,
      visionClient: visionClient ?? mockVisionClient,
      layoutResolution: dependencyOverrides.layoutResolution,
      dpiCalibration: dependencyOverrides.dpiCalibration,
    }
  );

  const setVisionButtons = (buttons: Partial<VisionOutput["actionButtons"]>): void => {
    mockVisionClient.captureAndParse.mockResolvedValue({
      ...defaultVisionSnapshot,
      actionButtons: {
        ...defaultVisionSnapshot.actionButtons,
        ...buttons
      }
    });
  };

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    mockWindowManager = {
      findPokerWindow: vi.fn().mockResolvedValue({ id: 1, processName: "poker", title: "Table 1" }),
      getWindowBounds: vi.fn().mockResolvedValue({ x: 0, y: 0, width: 800, height: 600 }),
      validateWindow: vi.fn().mockReturnValue(true),
      focusWindow: vi.fn().mockResolvedValue(true),
      visionToScreenCoords: vi.fn((visionX, visionY, layoutResolution, windowBounds, dpiCalibration) => ({
        x: (windowBounds.x + (visionX / layoutResolution.width) * windowBounds.width) * dpiCalibration,
        y: (windowBounds.y + (visionY / layoutResolution.height) * windowBounds.height) * dpiCalibration
      }))
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

    mockVisionClient = {
      captureAndParse: vi.fn().mockResolvedValue(defaultVisionSnapshot)
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
      mockVisionClient.captureAndParse.mockRejectedValue(new Error("Vision timeout"));
      const executor = createExecutor();

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
      setVisionButtons({
        call: { ...baselineVisionButton, isEnabled: true, isVisible: true, screenCoords: { x: 0, y: 0 } },
        fold: { ...baselineVisionButton, isEnabled: true, isVisible: true, screenCoords: { x: 0, y: 0 } }
      });

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
      setVisionButtons({
        raise: { screenCoords: { x: 250, y: 420 }, isEnabled: true, isVisible: true, confidence: 0.95 }
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
      setVisionButtons({
        raise: actionButton
      });

      const result = await executor.execute(baseDecision, { verifyAction: false });
      const betInputMock = mockBetInputHandler.inputBetAmount;

      expect(result.success).toBe(true);
      expect(betInputMock).toHaveBeenCalledTimes(1);
      expect(mockInputAutomation.clickScreenCoords).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number)
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
      setVisionButtons({
        call: { screenCoords: { x: 200, y: 300 }, isEnabled: true, isVisible: true, confidence: 0.9 }
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
      setVisionButtons({
        fold: { screenCoords: { x: 80, y: 120 }, isEnabled: true, isVisible: true, confidence: 0.95 }
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
      setVisionButtons({
        call: { screenCoords: { x: 250, y: 350 }, isEnabled: true, isVisible: true, confidence: 0.95 }
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

    it("7.2 Property 13: derives turn from turn state when valid and from buttons otherwise", async () => {
      const executor = createExecutor();

      await fc.assert(
        fc.property(
          fc.record({
            hasTurnState: fc.boolean(),
            turnStateHero: fc.boolean(),
            turnStateConfidenceValid: fc.boolean(),
            foldEnabled: fc.boolean(),
            foldVisible: fc.boolean(),
            checkEnabled: fc.boolean(),
            checkVisible: fc.boolean(),
            callEnabled: fc.boolean(),
            callVisible: fc.boolean(),
            raiseEnabled: fc.boolean(),
            raiseVisible: fc.boolean(),
            betEnabled: fc.boolean(),
            betVisible: fc.boolean(),
            allInEnabled: fc.boolean(),
            allInVisible: fc.boolean()
          }),
          ({ hasTurnState, turnStateHero, turnStateConfidenceValid, foldEnabled, foldVisible, checkEnabled, checkVisible, callEnabled, callVisible, raiseEnabled, raiseVisible, betEnabled, betVisible, allInEnabled, allInVisible }) => {
            const snapshot: VisionOutput = {
              confidence: { overall: 0.99 },
              ...(hasTurnState
                ? {
                    turnState: {
                      isHeroTurn: turnStateHero,
                      confidence: turnStateConfidenceValid ? 0.7 : 2
                    }
                  }
                : {}),
              actionButtons: {
                fold: {
                  screenCoords: { x: 1, y: 1 },
                  isEnabled: foldEnabled,
                  isVisible: foldVisible,
                  confidence: 0.9
                },
                check: {
                  screenCoords: { x: 2, y: 2 },
                  isEnabled: checkEnabled,
                  isVisible: checkVisible,
                  confidence: 0.9
                },
                call: {
                  screenCoords: { x: 3, y: 3 },
                  isEnabled: callEnabled,
                  isVisible: callVisible,
                  confidence: 0.9
                },
                raise: {
                  screenCoords: { x: 4, y: 4 },
                  isEnabled: raiseEnabled,
                  isVisible: raiseVisible,
                  confidence: 0.9
                },
                bet: {
                  screenCoords: { x: 5, y: 5 },
                  isEnabled: betEnabled,
                  isVisible: betVisible,
                  confidence: 0.9
                },
                allIn: {
                  screenCoords: { x: 6, y: 6 },
                  isEnabled: allInEnabled,
                  isVisible: allInVisible,
                  confidence: 0.9
                }
              }
            };

            mockVisionClient.captureAndParse.mockResolvedValue(snapshot);

            const expectedTurn = hasTurnState && turnStateConfidenceValid
              ? turnStateHero
              : Boolean(
                  (foldEnabled && foldVisible) ||
                    (checkEnabled && checkVisible) ||
                    (callEnabled && callVisible) ||
                    (raiseEnabled && raiseVisible) ||
                    (betEnabled && betVisible) ||
                    (allInEnabled && allInVisible)
                );

            const resolvedTurn = (executor as any).isHeroTurn(snapshot) as boolean;
            expect(resolvedTurn).toBe(expectedTurn);
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it("handles missing action button as error and disabled action button as warning", async () => {
      const disabledLoggerExecutor = createExecutor(
        undefined,
        mockLogger,
        {
          captureAndParse: vi.fn().mockResolvedValue({
            confidence: { overall: 0.99 },
            turnState: { isHeroTurn: true, confidence: 0.99 },
            actionButtons: {
              call: {
                screenCoords: { x: 100, y: 200 },
                isEnabled: false,
                isVisible: true,
                confidence: 0.95
              }
            }
          })
        } as VisionClientInterface
      );

      const disabledResult = await disabledLoggerExecutor.execute(
        {
          ...baseDecision,
          action: { ...baseDecision.action, type: "call", amount: undefined }
        },
        { verifyAction: false }
      );

      expect(disabledResult.success).toBe(false);
      expect(disabledResult.error).toContain("not actionable");
      expect(mockLogger.warn).toHaveBeenCalled();

      const missingLoggerExecutor = createExecutor(
        undefined,
        mockLogger,
        {
          captureAndParse: vi.fn().mockResolvedValue({
            confidence: { overall: 0.99 },
            turnState: { isHeroTurn: true, confidence: 0.99 },
            actionButtons: {
              check: {
                screenCoords: { x: 100, y: 200 },
                isEnabled: true,
                isVisible: true,
                confidence: 0.95
              }
            }
          })
        } as VisionClientInterface
      );

      const missingResult = await missingLoggerExecutor.execute(
        {
          ...baseDecision,
          action: { ...baseDecision.action, type: "call", amount: undefined }
        },
        { verifyAction: false }
      );

      expect(missingResult.success).toBe(false);
      expect(missingResult.error).toContain("not found");
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("treats low-confidence action button as non-actionable and skips click", async () => {
      const executor = createExecutor(
        undefined,
        mockLogger,
        {
          captureAndParse: vi.fn().mockResolvedValue({
            confidence: { overall: 0.99 },
            turnState: { isHeroTurn: true, confidence: 0.99 },
            actionButtons: {
              call: {
                screenCoords: { x: 100, y: 200 },
                isEnabled: true,
                isVisible: true,
                confidence: 0.2
              }
            }
          })
        } as VisionClientInterface
      );

      const result = await executor.execute(
        {
          ...baseDecision,
          action: { ...baseDecision.action, type: "call", amount: undefined }
        },
        { verifyAction: false }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not actionable");
      expect(mockInputAutomation.clickScreenCoords).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("uses bet button fallback for raise actions when raise button is absent", async () => {
      const executor = createExecutor(
        undefined,
        mockLogger,
        {
          captureAndParse: vi.fn().mockResolvedValue({
            confidence: { overall: 0.99 },
            turnState: { isHeroTurn: true, confidence: 0.99 },
            actionButtons: {
              raise: undefined,
              bet: {
                screenCoords: { x: 420, y: 610 },
                isEnabled: true,
                isVisible: true,
                confidence: 0.95
              }
            }
          })
        } as VisionClientInterface
      );

      const result = await executor.execute(baseDecision, { verifyAction: false });

      expect(result.success).toBe(true);
      expect(mockWindowManager.visionToScreenCoords).toHaveBeenCalledWith(
        420,
        610,
        { width: 1920, height: 1080 },
        { x: 0, y: 0, width: 800, height: 600 },
        1
      );
      expect(mockInputAutomation.clickScreenCoords).toHaveBeenCalledTimes(1);
    });

    it("fails raise actions when both raise and bet buttons are absent", async () => {
      const executor = createExecutor(
        undefined,
        mockLogger,
        {
          captureAndParse: vi.fn().mockResolvedValue({
            confidence: { overall: 0.99 },
            turnState: { isHeroTurn: true, confidence: 0.99 },
            actionButtons: {
              call: {
                screenCoords: { x: 100, y: 200 },
                isEnabled: true,
                isVisible: true,
                confidence: 0.95
              }
            }
          })
        } as VisionClientInterface
      );

      const result = await executor.execute(baseDecision, { verifyAction: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Action button raise not found");
      expect(mockInputAutomation.clickScreenCoords).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("treats raise->bet fallback button as non-actionable when disabled", async () => {
      const executor = createExecutor(
        undefined,
        mockLogger,
        {
          captureAndParse: vi.fn().mockResolvedValue({
            confidence: { overall: 0.99 },
            turnState: { isHeroTurn: true, confidence: 0.99 },
            actionButtons: {
              raise: undefined,
              bet: {
                screenCoords: { x: 420, y: 610 },
                isEnabled: false,
                isVisible: true,
                confidence: 0.95
              }
            }
          })
        } as VisionClientInterface
      );

      const result = await executor.execute(baseDecision, { verifyAction: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not actionable");
      expect(mockInputAutomation.clickScreenCoords).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("fails deterministically when translated click is out of bounds", async () => {
      mockInputAutomation.clickScreenCoords.mockRejectedValue(
        new Error("Click coordinates (5000, 5000) are outside window bounds")
      );
      const executor = createExecutor();
      setVisionButtons({
        call: {
          screenCoords: { x: 1900, y: 1000 },
          isEnabled: true,
          isVisible: true,
          confidence: 0.95
        }
      });

      const result = await executor.execute(
        {
          ...baseDecision,
          action: { ...baseDecision.action, type: "call", amount: undefined }
        },
        { verifyAction: false }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Action execution failed");
      expect(result.error).toContain("outside window bounds");
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("7.3 Property 15: uses WindowManager vision coordinates and click translated screen coordinates", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 1920 }),
          fc.integer({ min: 1, max: 1080 }),
          fc.integer({ min: -1000, max: 3000 }),
          fc.integer({ min: -1000, max: 2000 }),
          fc.integer({ min: 300, max: 3000 }),
          fc.integer({ min: 200, max: 2000 }),
          fc.integer({ min: 1, max: 2 }),
          fc.integer({ min: 1, max: 1080 }),
          fc.integer({ min: 1, max: 1920 }),
          async (
            visionX,
            visionY,
            windowX,
            windowY,
            windowWidth,
            windowHeight,
            dpiCalibration,
            layoutWidth,
            layoutHeight
          ) => {
            mockVisionClient.captureAndParse.mockClear();
            mockWindowManager.visionToScreenCoords.mockClear();
            mockInputAutomation.clickScreenCoords.mockClear();

            mockWindowManager.getWindowBounds
              .mockResolvedValueOnce({ x: 0, y: 0, width: 800, height: 600 })
              .mockResolvedValueOnce({ x: windowX, y: windowY, width: windowWidth, height: windowHeight });

            mockVisionClient.captureAndParse.mockResolvedValue({
              confidence: { overall: 0.99 },
              turnState: { isHeroTurn: true, confidence: 0.99 },
              actionButtons: {
                call: {
                  screenCoords: { x: visionX, y: visionY },
                  isEnabled: true,
                  isVisible: true,
                  confidence: 0.95
                }
              }
            });

            const executor = createExecutorWithOverrides(
              undefined,
              mockLogger,
              {
                captureAndParse: mockVisionClient.captureAndParse
              } as VisionClientInterface,
              {
                layoutResolution: {
                  width: layoutWidth,
                  height: layoutHeight
                },
                dpiCalibration
              }
            );
            const callDecision: StrategyDecision = {
              ...baseDecision,
              action: { ...baseDecision.action, type: "call", amount: undefined }
            };
            await executor.execute(callDecision, { verifyAction: false, timeoutMs: 1000 });

            expect(mockWindowManager.visionToScreenCoords).toHaveBeenCalledTimes(1);
            expect(mockInputAutomation.clickScreenCoords).toHaveBeenCalledTimes(1);

            const expectedX = (windowX + (visionX / layoutWidth) * windowWidth) * dpiCalibration;
            const expectedY = (windowY + (visionY / layoutHeight) * windowHeight) * dpiCalibration;

            expect(mockInputAutomation.clickScreenCoords).toHaveBeenLastCalledWith(expectedX, expectedY);
            expect(mockVisionClient.captureAndParse).toHaveBeenCalledTimes(1);
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
