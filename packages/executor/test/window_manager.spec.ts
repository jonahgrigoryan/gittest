import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { WindowManager, type AppleScriptRunner } from "../src/window_manager";
import type { WindowConfig } from "../src/types";

type MockLogger = Pick<Console, "debug" | "info" | "warn" | "error">;

interface WindowFixture {
  processName: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const textChars = [
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."0123456789",
  " ",
  "-",
  "_"
] as const;

const tokenArb = fc
  .array(fc.constantFrom(...textChars), { minLength: 3, maxLength: 14 })
  .map((chars) => chars.join("").trim())
  .filter((token) => token.length > 0);

const noiseWindowArb: fc.Arbitrary<WindowFixture> = fc.record({
  processName: tokenArb.map((token) => `NoiseProc-${token}`),
  title: tokenArb.map((token) => `NoiseTable-${token}`),
  x: fc.integer({ min: -2000, max: 2000 }),
  y: fc.integer({ min: -2000, max: 2000 }),
  width: fc.integer({ min: 300, max: 2200 }),
  height: fc.integer({ min: 300, max: 1600 })
});

function createLogger(): MockLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

function createRunner(handler: (script: string) => Promise<string> | string): AppleScriptRunner {
  return {
    run: vi.fn(async (script: string) => handler(script))
  };
}

function encodeWindow(window: WindowFixture, index: number): string {
  return [
    window.processName,
    String(index),
    window.title,
    String(window.x),
    String(window.y),
    String(window.width),
    String(window.height)
  ].join("||");
}

describe("WindowManager", () => {
  const config: WindowConfig = {
    titlePatterns: ["Primary Table", "Secondary Table"],
    processNames: ["CoinPoker"],
    minWindowSize: { width: 800, height: 600 }
  };

  it("Feature: coinpoker-macos-autonomy, Property 1: Window Discovery and Selection", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(noiseWindowArb, { minLength: 0, maxLength: 20 }),
        fc.integer({ min: -2500, max: 2500 }),
        fc.integer({ min: -2500, max: 2500 }),
        fc.integer({ min: 800, max: 2400 }),
        fc.integer({ min: 600, max: 1600 }),
        fc.integer({ min: -2500, max: 2500 }),
        fc.integer({ min: -2500, max: 2500 }),
        fc.integer({ min: 800, max: 2400 }),
        fc.integer({ min: 600, max: 1600 }),
        async (
          noiseWindows,
          primaryX,
          primaryY,
          primaryWidth,
          primaryHeight,
          secondaryX,
          secondaryY,
          secondaryWidth,
          secondaryHeight
        ) => {
          const secondary: WindowFixture = {
            processName: "CoinPoker",
            title: `Secondary Table #${secondaryWidth}`,
            x: secondaryX,
            y: secondaryY,
            width: secondaryWidth,
            height: secondaryHeight
          };
          const primary: WindowFixture = {
            processName: "CoinPoker",
            title: `Primary Table #${primaryWidth}`,
            x: primaryX,
            y: primaryY,
            width: primaryWidth,
            height: primaryHeight
          };

          // Put secondary first to ensure selection prioritizes title pattern order.
          const windows = [...noiseWindows, secondary, primary];
          const output = windows.map((window, index) => encodeWindow(window, index + 1)).join("\n");

          const manager = new WindowManager(config, createLogger(), createRunner(async () => output));
          const found = await manager.findPokerWindow();

          expect(found).not.toBeNull();
          expect(found?.processName).toContain("CoinPoker");
          expect(found?.title).toContain("Primary Table");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Feature: coinpoker-macos-autonomy, Property 2: Window Bounds Retrieval", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -3000, max: 3000 }),
        fc.integer({ min: -3000, max: 3000 }),
        fc.integer({ min: 1, max: 4000 }),
        fc.integer({ min: 1, max: 3000 }),
        async (x, y, width, height) => {
          const output = `${x}||${y}||${width}||${height}`;
          const manager = new WindowManager(config, createLogger(), createRunner(async () => output));

          const bounds = await manager.getWindowBounds({
            id: "CoinPoker:1",
            processName: "CoinPoker",
            title: "Primary Table"
          });

          expect(bounds).toEqual({ x, y, width, height });
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Feature: coinpoker-macos-autonomy, Property 3: Window Size Validation", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 799 }),
        fc.integer({ min: 1, max: 599 }),
        fc.boolean(),
        async (smallWidth, smallHeight, failOnWidth) => {
          const width = failOnWidth ? smallWidth : 1000;
          const height = failOnWidth ? 900 : smallHeight;
          const undersizedWindow: WindowFixture = {
            processName: "CoinPoker",
            title: "Primary Table #undersized",
            x: 200,
            y: 100,
            width,
            height
          };
          const output = encodeWindow(undersizedWindow, 1);
          const manager = new WindowManager(config, createLogger(), createRunner(async () => output));

          const found = await manager.findPokerWindow();
          expect(found).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns null when no discovery selectors are configured", async () => {
    const runner = createRunner(async () =>
      encodeWindow(
        {
          processName: "UnrelatedApp",
          title: "Some Window",
          x: 10,
          y: 10,
          width: 1800,
          height: 1200
        },
        1
      )
    );
    const manager = new WindowManager(
      {
        titlePatterns: [],
        processNames: [],
        minWindowSize: { width: 800, height: 600 }
      },
      createLogger(),
      runner
    );

    const found = await manager.findPokerWindow();
    expect(found).toBeNull();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("returns false from focusWindow when AppleScript does not confirm success", async () => {
    const manager = new WindowManager(config, createLogger(), createRunner(async () => "not-ok"));
    const focused = await manager.focusWindow({
      id: "CoinPoker:1",
      processName: "CoinPoker",
      title: "Primary Table"
    });
    expect(focused).toBe(false);
  });

  it("returns false from focusWindow when runner throws", async () => {
    const manager = new WindowManager(
      config,
      createLogger(),
      createRunner(async () => {
        throw new Error("window missing");
      })
    );
    const focused = await manager.focusWindow({
      id: "CoinPoker:1",
      processName: "CoinPoker",
      title: "Primary Table"
    });
    expect(focused).toBe(false);
  });
});
