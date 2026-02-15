import { describe, it, expect, vi, beforeEach } from "vitest";
import { createActionExecutor } from "../src/index";
import type { ExecutorConfig, ResearchUIConfig } from "../src/types";

// Mock dependencies
vi.mock("../src/window_manager", () => {
  return {
    WindowManager: vi.fn().mockImplementation(() => ({
      findPokerWindow: vi.fn().mockResolvedValue({ id: 1, title: "Test", processName: "Test" }),
    })),
    OsaScriptRunner: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(""),
    })),
  };
});

vi.mock("../src/compliance", () => {
  return {
    ComplianceChecker: vi.fn().mockImplementation(() => ({
      validateExecution: vi.fn().mockResolvedValue(true),
    })),
  };
});

vi.mock("../src/research_bridge", () => {
  return {
    ResearchUIExecutor: vi.fn().mockImplementation(() => ({
      execute: vi.fn(),
    })),
  };
});

vi.mock("../src/bet_input_handler", () => {
  return {
    BetInputHandler: vi.fn().mockImplementation(() => ({
      inputBetAmount: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe("createActionExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ResearchUI config validation", () => {
    const validBetInputField = {
      x: 100,
      y: 200,
      width: 150,
      height: 30,
      decimalPrecision: 2,
      decimalSeparator: "." as const,
    };

    const baseResearchUIConfig: ResearchUIConfig = {
      allowlist: ["CoinPoker"],
      prohibitedSites: ["pokerstars.com"],
      requireBuildFlag: true,
      betInputField: validBetInputField,
      minRaiseAmount: 2,
    };

    it("accepts valid betInputField configuration", () => {
      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          betInputField: validBetInputField,
        },
      };

      expect(() => createActionExecutor("research-ui", config, undefined, console)).not.toThrow();
    });

    it("throws descriptive error when betInputField is missing", () => {
      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          betInputField: undefined,
        },
      };

      expect(() => createActionExecutor("research-ui", config, undefined, console)).toThrow(
        "betInputField is required for research-ui mode"
      );
    });

    it("throws descriptive error when minRaiseAmount is missing", () => {
      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          minRaiseAmount: undefined,
        },
      };

      expect(() => createActionExecutor("research-ui", config, undefined, console)).toThrow(
        "minRaiseAmount is required for research-ui mode"
      );
    });

    it("throws descriptive error for missing betInputField.x", () => {
      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          betInputField: {
            ...validBetInputField,
            x: undefined as unknown as number,
          },
        },
      };

      expect(() => createActionExecutor("research-ui", config, undefined, console)).toThrow(
        "betInputField.x must be a number"
      );
    });

    it("throws descriptive error for missing betInputField.y", () => {
      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          betInputField: {
            ...validBetInputField,
            y: undefined as unknown as number,
          },
        },
      };

      expect(() => createActionExecutor("research-ui", config, undefined, console)).toThrow(
        "betInputField.y must be a number"
      );
    });

    it("throws descriptive error for invalid betInputField.width", () => {
      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          betInputField: {
            ...validBetInputField,
            width: 0,
          },
        },
      };

      expect(() => createActionExecutor("research-ui", config, undefined, console)).toThrow(
        "betInputField.width must be a positive number"
      );
    });

    it("throws descriptive error for invalid betInputField.height", () => {
      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          betInputField: {
            ...validBetInputField,
            height: -10,
          },
        },
      };

      expect(() => createActionExecutor("research-ui", config, undefined, console)).toThrow(
        "betInputField.height must be a positive number"
      );
    });

    it("throws descriptive error for invalid betInputField.decimalPrecision", () => {
      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          betInputField: {
            ...validBetInputField,
            decimalPrecision: 15,
          },
        },
      };

      expect(() => createActionExecutor("research-ui", config, undefined, console)).toThrow(
        "betInputField.decimalPrecision must be a number between 0 and 10"
      );
    });

    it("throws descriptive error for negative betInputField.decimalPrecision", () => {
      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          betInputField: {
            ...validBetInputField,
            decimalPrecision: -1,
          },
        },
      };

      expect(() => createActionExecutor("research-ui", config, undefined, console)).toThrow(
        "betInputField.decimalPrecision must be a number between 0 and 10"
      );
    });

    it("throws descriptive error for invalid betInputField.decimalSeparator", () => {
      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          betInputField: {
            ...validBetInputField,
            decimalSeparator: ";" as unknown as "," | ".",
          },
        },
      };

      expect(() => createActionExecutor("research-ui", config, undefined, console)).toThrow(
        'betInputField.decimalSeparator must be "," or "."'
      );
    });

    it("accepts comma as decimal separator", () => {
      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          betInputField: {
            ...validBetInputField,
            decimalSeparator: ",",
          },
        },
      };

      expect(() => createActionExecutor("research-ui", config, undefined, console)).not.toThrow();
    });

    it("throws descriptive error for negative minRaiseAmount", () => {
      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          minRaiseAmount: -1,
        },
      };

      expect(() => createActionExecutor("research-ui", config, undefined, console)).toThrow(
        "minRaiseAmount must be a non-negative number"
      );
    });

    it("accepts valid minRaiseAmount", () => {
      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          minRaiseAmount: 2,
        },
      };

      expect(() => createActionExecutor("research-ui", config, undefined, console)).not.toThrow();
    });

    it("accepts zero minRaiseAmount", () => {
      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          minRaiseAmount: 0,
        },
      };

      expect(() => createActionExecutor("research-ui", config, undefined, console)).not.toThrow();
    });

    it("reports multiple validation errors at once", () => {
      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          betInputField: {
            ...validBetInputField,
            width: -1,
            height: -2,
            decimalSeparator: ";" as unknown as "," | ".",
          },
        },
      };

      expect(() => createActionExecutor("research-ui", config, undefined, console)).toThrow(
        /betInputField\.width.*betInputField\.height.*betInputField\.decimalSeparator/
      );
    });

    it("throws error when researchUI config is missing", () => {
      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
      };

      expect(() => createActionExecutor("research-ui", config, undefined, console)).toThrow(
        "Research UI config required for research-ui mode"
      );
    });

    it("rejects research-ui config when all window selectors are empty", () => {
      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          allowlist: [],
          windowTitlePatterns: [],
          processNames: [],
        },
      };

      expect(() => createActionExecutor("research-ui", config, undefined, console)).toThrow(
        "at least one window selector"
      );
    });

    it("maps window config from researchUI fields and supports injected AppleScript runner", async () => {
      const { WindowManager, OsaScriptRunner } = await import("../src/window_manager");
      const injectedRunner = {
        run: vi.fn().mockResolvedValue(""),
      };

      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          windowTitlePatterns: ["CoinPoker Table"],
          processNames: ["CoinPoker"],
          minWindowSize: { width: 1200, height: 700 },
        },
      };

      createActionExecutor("research-ui", config, undefined, console, {
        appleScriptRunner: injectedRunner,
      });

      expect(WindowManager).toHaveBeenCalledWith(
        {
          titlePatterns: ["CoinPoker Table"],
          processNames: ["CoinPoker"],
          minWindowSize: { width: 1200, height: 700 },
        },
        expect.anything(),
        injectedRunner
      );
      expect(OsaScriptRunner).not.toHaveBeenCalled();
    });

    it("falls back to OsaScriptRunner when no runner override is provided", async () => {
      const { OsaScriptRunner } = await import("../src/window_manager");

      const config: ExecutorConfig = {
        enabled: true,
        mode: "research-ui",
        verifyActions: true,
        maxRetries: 1,
        verificationTimeoutMs: 2000,
        researchUI: {
          ...baseResearchUIConfig,
          windowTitlePatterns: ["CoinPoker"],
          processNames: ["CoinPoker"],
        },
      };

      createActionExecutor("research-ui", config, undefined, console);

      expect(OsaScriptRunner).toHaveBeenCalledTimes(1);
    });
  });
});
