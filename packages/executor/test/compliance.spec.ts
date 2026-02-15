import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { ComplianceChecker } from "../src/compliance";

interface ProcessWindowEntry {
  processName: string;
  title: string;
}

interface ProcessSnapshot {
  runningProcesses: string[];
  frontmostProcess?: string;
  windows: ProcessWindowEntry[];
}

const ascii = [
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."0123456789",
  "-",
  "_"
] as const;

const tokenArb = fc
  .array(fc.constantFrom(...ascii), { minLength: 3, maxLength: 18 })
  .map((chars) => chars.join(""))
  .filter((value) => value.trim().length > 0);

function createLogger(): Pick<Console, "debug" | "info" | "warn" | "error"> {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

function createChecker(
  config: {
    allowlist: string[];
    prohibitedSites: string[];
    requireBuildFlag: boolean;
    processNames?: string[];
  },
  snapshot: ProcessSnapshot
): ComplianceChecker {
  const provider = {
    getSnapshot: vi.fn(async () => snapshot)
  };

  return new ComplianceChecker(config as any, createLogger(), provider as any);
}

const mockDecision = {
  action: {
    type: "fold",
    position: "BTN",
    street: "flop"
  }
} as any;

describe("ComplianceChecker", () => {
  const originalBuildFlag = process.env.RESEARCH_UI_ENABLED;

  beforeEach(() => {
    delete process.env.RESEARCH_UI_ENABLED;
  });

  afterEach(() => {
    if (originalBuildFlag === undefined) {
      delete process.env.RESEARCH_UI_ENABLED;
      return;
    }
    process.env.RESEARCH_UI_ENABLED = originalBuildFlag;
  });

  it("Feature: coinpoker-macos-autonomy, Property 5: Process Running Verification", async () => {
    await fc.assert(
      fc.asyncProperty(
        tokenArb,
        fc.array(tokenArb, { minLength: 0, maxLength: 10 }),
        async (requiredSuffix, noiseTokens) => {
          const requiredProcess = `CoinPoker-${requiredSuffix}`;
          const runningProcesses = noiseTokens
            .map((token) => `Noise-${token}`)
            .filter((name) => !name.toLowerCase().includes(requiredSuffix.toLowerCase()));

          const checker = createChecker(
            {
              allowlist: [requiredProcess],
              processNames: [requiredProcess],
              prohibitedSites: [],
              requireBuildFlag: false
            },
            {
              runningProcesses,
              frontmostProcess: runningProcesses[0],
              windows: []
            }
          );

          const result = await checker.checkEnvironment();

          expect(result.allowed).toBe(false);
          expect(result.violations.some((violation) => /required process.*not running/i.test(violation))).toBe(
            true
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Feature: coinpoker-macos-autonomy, Property 6: Process Allowlist Enforcement", async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, tokenArb, async (allowedSuffix, disallowedSuffix) => {
        const requiredProcess = `CoinPoker-${allowedSuffix}`;
        const disallowedFrontmost = `Forbidden-${disallowedSuffix}`;

        fc.pre(
          !disallowedFrontmost.toLowerCase().includes(requiredProcess.toLowerCase()) &&
            !requiredProcess.toLowerCase().includes(disallowedFrontmost.toLowerCase())
        );

        const checker = createChecker(
          {
            allowlist: [requiredProcess],
            processNames: [requiredProcess],
            prohibitedSites: [],
            requireBuildFlag: false
          },
          {
            runningProcesses: [requiredProcess, disallowedFrontmost],
            frontmostProcess: disallowedFrontmost,
            windows: []
          }
        );

        const result = await checker.checkEnvironment();

        expect(result.allowed).toBe(false);
        expect(result.violations.some((violation) => /active process.*allowlist/i.test(violation))).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("Feature: coinpoker-macos-autonomy, Property 7: Prohibited Process Rejection", async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, tokenArb, fc.boolean(), async (allowedSuffix, prohibitedToken, injectInWindow) => {
        const allowedProcess = `CoinPoker-${allowedSuffix}`;
        const prohibitedIndicator = `forbidden-${prohibitedToken}`;

        const checker = createChecker(
          {
            allowlist: [allowedProcess],
            processNames: [allowedProcess],
            prohibitedSites: [prohibitedIndicator],
            requireBuildFlag: false
          },
          {
            runningProcesses: injectInWindow
              ? [allowedProcess]
              : [allowedProcess, `Helper-${prohibitedIndicator}`],
            frontmostProcess: allowedProcess,
            windows: injectInWindow
              ? [
                  {
                    processName: allowedProcess,
                    title: `Lobby ${prohibitedIndicator}`
                  }
                ]
              : []
          }
        );

        const result = await checker.checkEnvironment();

        expect(result.allowed).toBe(false);
        expect(
          result.violations.some(
            (violation) => /prohibited/i.test(violation) && violation.toLowerCase().includes(prohibitedIndicator.toLowerCase())
          )
        ).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("Feature: coinpoker-macos-autonomy, Property 8: Build Flag Validation", async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, async (allowedSuffix) => {
        const allowedProcess = `CoinPoker-${allowedSuffix}`;
        delete process.env.RESEARCH_UI_ENABLED;

        const checker = createChecker(
          {
            allowlist: [allowedProcess],
            processNames: [allowedProcess],
            prohibitedSites: [],
            requireBuildFlag: true
          },
          {
            runningProcesses: [allowedProcess],
            frontmostProcess: allowedProcess,
            windows: []
          }
        );

        const result = await checker.checkEnvironment();

        expect(result.allowed).toBe(false);
        expect(result.violations.some((violation) => /RESEARCH_UI_ENABLED/i.test(violation))).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("validateExecution returns false when compliance fails", async () => {
    delete process.env.RESEARCH_UI_ENABLED;

    const checker = createChecker(
      {
        allowlist: ["CoinPoker"],
        processNames: ["CoinPoker"],
        prohibitedSites: [],
        requireBuildFlag: true
      },
      {
        runningProcesses: ["CoinPoker"],
        frontmostProcess: "CoinPoker",
        windows: []
      }
    );

    await expect(checker.validateExecution(mockDecision)).resolves.toBe(false);
  });

  it("validateExecution returns true when compliance passes", async () => {
    process.env.RESEARCH_UI_ENABLED = "true";

    const checker = createChecker(
      {
        allowlist: ["CoinPoker"],
        processNames: ["CoinPoker"],
        prohibitedSites: [],
        requireBuildFlag: true
      },
      {
        runningProcesses: ["CoinPoker"],
        frontmostProcess: "CoinPoker",
        windows: []
      }
    );

    await expect(checker.validateExecution(mockDecision)).resolves.toBe(true);
  });
});
