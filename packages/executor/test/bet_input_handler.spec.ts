import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { BetInputHandler } from "../src/bet_input_handler";
import type { Action } from "@poker-bot/shared";

type MockLogger = Pick<Console, "debug" | "info" | "warn" | "error">;

function createLogger(): MockLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

function createRaiseAction(amount: number): Action {
  return {
    type: "raise",
    amount,
    position: "BTN",
    street: "flop"
  };
}

describe("BetInputHandler", () => {
  it("Feature: coinpoker-macos-autonomy, Property 9: Bet Amount Rounding", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 0, max: 6 }),
        async (amount, precision) => {
          const handler = new BetInputHandler(
            {
              allowlist: ["CoinPoker"],
              prohibitedSites: [],
              requireBuildFlag: false,
              minRaiseAmount: 0,
              betInputField: {
                x: 100,
                y: 200,
                width: 150,
                height: 30,
                decimalPrecision: precision,
                decimalSeparator: "."
              }
            },
            createLogger()
          );

          const formatted = (handler as any).formatAmount(amount) as string;
          const expected = amount.toFixed(precision);
          expect(formatted).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Feature: coinpoker-macos-autonomy, Property 10: Minimum Raise Enforcement", async () => {
    await fc.assert(
        fc.asyncProperty(
        fc.double({ min: 0.01, max: 1_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.0001, max: 0.9999, noNaN: true, noDefaultInfinity: true }),
        async (minRaiseAmount, ratio) => {
          const handler = new BetInputHandler(
            {
              allowlist: ["CoinPoker"],
              prohibitedSites: [],
              requireBuildFlag: false,
              minRaiseAmount,
              betInputField: {
                x: 100,
                y: 200,
                width: 150,
                height: 30,
                decimalPrecision: 2,
                decimalSeparator: "."
              }
            },
            createLogger()
          );

          const amount = minRaiseAmount * ratio;
          const promise = handler.inputBetAmount(
            createRaiseAction(amount),
            { id: "CoinPoker:1", title: "CoinPoker Table", processName: "CoinPoker" },
            123
          );

          await expect(promise).rejects.toThrow(/below minimum raise amount/i);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Feature: coinpoker-macos-autonomy, Property 11: Decimal Separator Formatting", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 0, max: 6 }),
        fc.constantFrom<"." | ",">(".", ","),
        async (amount, precision, decimalSeparator) => {
          const handler = new BetInputHandler(
            {
              allowlist: ["CoinPoker"],
              prohibitedSites: [],
              requireBuildFlag: false,
              minRaiseAmount: 0,
              betInputField: {
                x: 10,
                y: 20,
                width: 100,
                height: 30,
                decimalPrecision: precision,
                decimalSeparator
              }
            },
            createLogger()
          );

          const formatted = (handler as any).formatAmount(amount) as string;
          if (decimalSeparator === ",") {
            expect(formatted.includes(".")).toBe(false);
            if (precision > 0) {
              expect(formatted.includes(",")).toBe(true);
            }
          } else {
            if (precision > 0) {
              expect(formatted.includes(".")).toBe(true);
            }
            expect(formatted.includes(",")).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Feature: coinpoker-macos-autonomy, Property 12: Bet Amount Round Trip", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 0, max: 6 }),
        fc.constantFrom<"." | ",">(".", ","),
        async (amount, precision, decimalSeparator) => {
          const handler = new BetInputHandler(
            {
              allowlist: ["CoinPoker"],
              prohibitedSites: [],
              requireBuildFlag: false,
              minRaiseAmount: 0,
              betInputField: {
                x: 10,
                y: 20,
                width: 120,
                height: 30,
                decimalPrecision: precision,
                decimalSeparator
              }
            },
            createLogger()
          );

          const formatted = (handler as any).formatAmount(amount) as string;
          const normalized = decimalSeparator === "," ? formatted.replace(",", ".") : formatted;
          const parsed = Number(normalized);
          const tolerance = Math.pow(10, -precision) + Number.EPSILON;

          expect(Number.isFinite(parsed)).toBe(true);
          expect(Math.abs(parsed - amount)).toBeLessThanOrEqual(tolerance);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("uses input automation for raise flow", async () => {
    const inputAutomation = {
      clickAt: vi.fn().mockResolvedValue(undefined),
      clearTextField: vi.fn().mockResolvedValue(undefined),
      typeText: vi.fn().mockResolvedValue(undefined)
    };

    const handler = new BetInputHandler(
      {
        allowlist: ["CoinPoker"],
        prohibitedSites: [],
        requireBuildFlag: false,
        minRaiseAmount: 2,
        betInputField: {
          x: 100,
          y: 200,
          width: 120,
          height: 30,
          decimalPrecision: 2,
          decimalSeparator: "."
        }
      },
      createLogger(),
      inputAutomation as any
    );
    vi.spyOn(handler as any, "delay").mockResolvedValue(undefined);

    await handler.inputBetAmount(
      createRaiseAction(42.5),
      { id: "CoinPoker:1", title: "CoinPoker Table", processName: "CoinPoker" },
      99
    );

    expect(inputAutomation.clickAt).toHaveBeenCalledTimes(1);
    expect(inputAutomation.clearTextField).toHaveBeenCalledTimes(1);
    expect(inputAutomation.typeText).toHaveBeenCalled();
  });

  it("rounds runtime raise amount to configured precision instead of rejecting", async () => {
    const inputAutomation = {
      clickAt: vi.fn().mockResolvedValue(undefined),
      clearTextField: vi.fn().mockResolvedValue(undefined),
      typeText: vi.fn().mockResolvedValue(undefined)
    };

    const handler = new BetInputHandler(
      {
        allowlist: ["CoinPoker"],
        prohibitedSites: [],
        requireBuildFlag: false,
        minRaiseAmount: 0.5,
        betInputField: {
          x: 40,
          y: 90,
          width: 120,
          height: 32,
          decimalPrecision: 2,
          decimalSeparator: "."
        }
      },
      createLogger(),
      inputAutomation as any
    );
    vi.spyOn(handler as any, "delay").mockResolvedValue(undefined);

    await expect(
      handler.inputBetAmount(
        createRaiseAction(1.239),
        { id: "CoinPoker:1", title: "CoinPoker Table", processName: "CoinPoker" },
        7
      )
    ).resolves.toBeUndefined();

    expect(inputAutomation.typeText.mock.calls.map(([value]) => value).join("")).toBe("1.24");
  });
});
