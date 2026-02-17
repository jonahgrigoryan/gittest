import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { InputAutomation } from "../src/input_automation";
import { WindowManager } from "../src/window_manager";
import type { WindowConfig } from "../src/types";

type MockLogger = Pick<Console, "debug" | "info" | "warn" | "error">;

function createLogger(): MockLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

function createWindowManager(): WindowManager {
  const config: WindowConfig = {
    titlePatterns: ["CoinPoker"],
    processNames: ["CoinPoker"],
    minWindowSize: { width: 800, height: 600 }
  };
  return new WindowManager(
    config,
    createLogger(),
    {
      run: vi.fn(async () => "")
    }
  );
}

describe("InputAutomation", () => {
  it("Feature: coinpoker-macos-autonomy, Property 31: Coordinate Scaling Correctness", async () => {
    const manager = createWindowManager();

    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 1, max: 4000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 3000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 10, max: 5000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 10, max: 5000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.5, max: 3, noNaN: true, noDefaultInfinity: true }),
        async (
          layoutWidth,
          layoutHeight,
          windowX,
          windowY,
          windowWidth,
          windowHeight,
          visionX,
          visionY,
          dpiCalibration
        ) => {
          fc.pre(visionX <= layoutWidth);
          fc.pre(visionY <= layoutHeight);

          const translated = manager.visionToScreenCoords(
            visionX,
            visionY,
            { width: layoutWidth, height: layoutHeight },
            { x: windowX, y: windowY, width: windowWidth, height: windowHeight },
            dpiCalibration
          );

          const expectedX = (windowX + (visionX / layoutWidth) * windowWidth) * dpiCalibration;
          const expectedY = (windowY + (visionY / layoutHeight) * windowHeight) * dpiCalibration;

          expect(translated.x).toBeCloseTo(expectedX, 10);
          expect(translated.y).toBeCloseTo(expectedY, 10);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Feature: coinpoker-macos-autonomy, Property 32: Out-of-Bounds Coordinate Rejection", async () => {
    const logger = createLogger();
    const provider = {
      setMouseSpeed: vi.fn(),
      moveMouse: vi.fn(),
      leftClick: vi.fn(),
      typeText: vi.fn(),
      pressKey: vi.fn(),
      releaseKey: vi.fn()
    };

    const automation = new InputAutomation(
      {
        dpiCalibration: 1,
        layoutResolution: { width: 1920, height: 1080 },
        windowBounds: { x: 100, y: 200, width: 400, height: 300 }
      },
      {
        visionToScreenCoords: vi.fn(() => ({ x: 9999, y: 9999 }))
      },
      logger,
      provider as any,
      { sleep: vi.fn(async () => undefined) }
    );

    await expect(automation.clickAt(10, 20)).rejects.toThrow(/outside window bounds/i);
    expect(provider.moveMouse).not.toHaveBeenCalled();
    expect(provider.leftClick).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("accepts in-bounds clicks when dpiCalibration > 1", async () => {
    const provider = {
      setMouseSpeed: vi.fn(),
      moveMouse: vi.fn(async () => undefined),
      leftClick: vi.fn(async () => undefined),
      typeText: vi.fn(async () => undefined),
      pressKey: vi.fn(async () => undefined),
      releaseKey: vi.fn(async () => undefined)
    };

    const automation = new InputAutomation(
      {
        dpiCalibration: 2,
        layoutResolution: { width: 400, height: 300 },
        windowBounds: { x: 100, y: 200, width: 400, height: 300 }
      },
      {
        visionToScreenCoords: vi.fn((visionX: number, visionY: number) => ({
          x: (100 + (visionX / 400) * 400) * 2,
          y: (200 + (visionY / 300) * 300) * 2
        }))
      },
      createLogger(),
      provider as any,
      { sleep: vi.fn(async () => undefined) }
    );

    await expect(automation.clickAt(200, 150)).resolves.toBeUndefined();
    expect(provider.moveMouse).toHaveBeenCalledTimes(1);
    expect(provider.leftClick).toHaveBeenCalledTimes(1);
  });

  it("applies deterministic pre-click delay in the 1-3 second range", async () => {
    const delays: number[] = [];
    const makeAutomation = () =>
      new InputAutomation(
        {
          dpiCalibration: 1,
          layoutResolution: { width: 1920, height: 1080 },
          windowBounds: { x: 0, y: 0, width: 1920, height: 1080 }
        },
        {
          visionToScreenCoords: vi.fn((x: number, y: number) => ({ x, y }))
        },
        createLogger(),
        {
          setMouseSpeed: vi.fn(),
          moveMouse: vi.fn(async () => undefined),
          leftClick: vi.fn(async () => undefined),
          typeText: vi.fn(async () => undefined),
          pressKey: vi.fn(async () => undefined),
          releaseKey: vi.fn(async () => undefined)
        } as any,
        {
          randomSeed: 42,
          mouseSpeed: 1800,
          sleep: async (ms: number) => {
            delays.push(ms);
          }
        }
      );

    const first = makeAutomation();
    const second = makeAutomation();

    await first.clickAt(100, 200);
    const firstDelay = delays[0];
    expect(firstDelay).toBeGreaterThanOrEqual(1000);
    expect(firstDelay).toBeLessThanOrEqual(3000);

    await second.clickAt(100, 200);
    const secondDelay = delays[1];
    expect(secondDelay).toBe(firstDelay);
  });
});
