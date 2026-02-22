import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutPack } from "@poker-bot/shared";

const mocks = vi.hoisted(() => ({
  createSolverClient: vi.fn(),
  VisionClient: vi.fn(),
  waitForReady: vi.fn(),
  closeSolver: vi.fn(),
  healthCheck: vi.fn(),
  closeVision: vi.fn(),
}));

vi.mock("../../src/solver_client/client", () => ({
  createSolverClient: mocks.createSolverClient,
}));

vi.mock("../../src/vision/client", () => ({
  VisionClient: mocks.VisionClient,
}));

import { validateStartupConnectivity } from "../../src/startup/validateConnectivity";

const roi = { x: 0, y: 0, width: 10, height: 10 };

const layoutPack: LayoutPack = {
  version: "test",
  platform: "test",
  theme: "test",
  resolution: { width: 800, height: 600 },
  dpiCalibration: 1,
  cardROIs: [],
  stackROIs: {
    BTN: roi,
    SB: roi,
    BB: roi,
    UTG: roi,
    MP: roi,
    CO: roi,
  },
  potROI: roi,
  buttonROI: roi,
  actionButtonROIs: {
    fold: roi,
    check: roi,
    call: roi,
    raise: roi,
    bet: roi,
    allIn: roi,
  },
  turnIndicatorROI: roi,
  windowPatterns: { titleRegex: ".*", processName: "test" },
};

describe("validateStartupConnectivity", () => {
  beforeEach(() => {
    delete process.env.ORCH_SKIP_STARTUP_CHECKS;
    mocks.waitForReady.mockReset();
    mocks.closeSolver.mockReset();
    mocks.healthCheck.mockReset();
    mocks.closeVision.mockReset();
    mocks.createSolverClient.mockReset();
    mocks.VisionClient.mockReset();

    mocks.createSolverClient.mockImplementation(() => ({
      waitForReady: mocks.waitForReady,
      close: mocks.closeSolver,
    }));
    mocks.VisionClient.mockImplementation(() => ({
      healthCheck: mocks.healthCheck,
      close: mocks.closeVision,
    }));

    mocks.waitForReady.mockResolvedValue(undefined);
    mocks.healthCheck.mockResolvedValue(true);
  });

  it("passes startup checks when solver and vision are healthy", async () => {
    await expect(
      validateStartupConnectivity({
        solverAddr: "127.0.0.1:50051",
        visionServiceUrl: "127.0.0.1:50052",
        layoutPack,
        requireAgentConnectivity: false,
        timeoutMs: 50,
      }),
    ).resolves.toBeUndefined();

    expect(mocks.waitForReady).toHaveBeenCalledWith(50);
    expect(mocks.healthCheck).toHaveBeenCalledTimes(1);
  });

  it("Feature: coinpoker-macos-autonomy, Property 23: Health Check Failure Handling", async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (visionThrowsError) => {
        if (visionThrowsError) {
          mocks.healthCheck.mockRejectedValueOnce(new Error("vision offline"));
        } else {
          mocks.healthCheck.mockResolvedValueOnce(false);
        }

        await expect(
          validateStartupConnectivity({
            solverAddr: "127.0.0.1:50051",
            visionServiceUrl: "127.0.0.1:50052",
            layoutPack,
            requireAgentConnectivity: false,
            timeoutMs: 50,
          }),
        ).rejects.toThrow(/Vision connectivity check failed/i);
      }),
      { numRuns: 100 },
    );
  });

  it("fails startup when vision health check returns unhealthy status", async () => {
    mocks.healthCheck.mockResolvedValue(false);

    await expect(
      validateStartupConnectivity({
        solverAddr: "127.0.0.1:50051",
        visionServiceUrl: "127.0.0.1:50052",
        layoutPack,
        requireAgentConnectivity: false,
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/Vision connectivity check failed/i);
  });

  it("fails startup when vision health check exceeds timeout guard", async () => {
    mocks.healthCheck.mockImplementation(
      () => new Promise<boolean>(() => {}),
    );

    await expect(
      validateStartupConnectivity({
        solverAddr: "127.0.0.1:50051",
        visionServiceUrl: "127.0.0.1:50052",
        layoutPack,
        requireAgentConnectivity: false,
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/timed out/i);
  });
});
