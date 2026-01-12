import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SafeModeController } from "../../src/health/safeModeController";
import { PanicStopController } from "../../src/health/panicStopController";
import type { PanicStopReason } from "@poker-bot/shared";

describe("PanicStopController", () => {
  describe("Phase 11: Idempotent Transitions", () => {
    it("triggers panic stop and latches reason", () => {
      const safeMode = new SafeModeController();
      const panic = new PanicStopController(safeMode);
      panic.trigger({
        type: "vision_confidence",
        detail: "low confidence",
        triggeredAt: Date.now(),
      });
      expect(panic.isActive()).toBe(true);
      expect(safeMode.isActive()).toBe(true);
      expect(panic.getReason()?.detail).toBe("low confidence");
    });

    it("idempotent: trigger() called twice ignores second call", () => {
      const safeMode = new SafeModeController();
      const panic = new PanicStopController(safeMode);
      panic.trigger({
        type: "vision_confidence",
        detail: "first reason",
        triggeredAt: Date.now(),
      });

      panic.trigger({
        type: "risk_limit",
        detail: "second reason",
        triggeredAt: Date.now(),
      });

      expect(panic.isActive()).toBe(true);
      expect(panic.getReason()?.detail).toBe("first reason");
      expect(panic.getReason()?.type).toBe("vision_confidence");
    });

    it("enters safe mode with panic reason when triggered", () => {
      const safeMode = new SafeModeController();
      const panic = new PanicStopController(safeMode);
      panic.trigger({
        type: "risk_limit",
        detail: "risk limit exceeded",
        triggeredAt: Date.now(),
      });

      expect(safeMode.isActive()).toBe(true);
      const state = safeMode.getState();
      expect(state.active).toBe(true);
      expect(state.reason).toBe("panic:risk_limit");
    });

    it("reset clears reason and deactivates", () => {
      const safeMode = new SafeModeController();
      const panic = new PanicStopController(safeMode);
      panic.trigger({
        type: "vision_confidence",
        detail: "low confidence",
        triggeredAt: Date.now(),
      });

      expect(panic.isActive()).toBe(true);
      expect(panic.getReason()).toBeDefined();

      panic.reset();

      expect(panic.isActive()).toBe(false);
      expect(panic.getReason()).toBeUndefined();
    });

    it("reset does not automatically exit safe mode", () => {
      const safeMode = new SafeModeController();
      const panic = new PanicStopController(safeMode);
      panic.trigger({
        type: "manual",
        detail: "manual trigger",
        triggeredAt: Date.now(),
      });

      expect(safeMode.isActive()).toBe(true);

      panic.reset();

      expect(panic.isActive()).toBe(false);
      expect(safeMode.isActive()).toBe(true);
    });

    it("after reset, can trigger again with new reason", () => {
      const safeMode = new SafeModeController();
      const panic = new PanicStopController(safeMode);

      panic.trigger({
        type: "vision_confidence",
        detail: "first",
        triggeredAt: Date.now(),
      });
      expect(panic.getReason()?.detail).toBe("first");

      panic.reset();

      panic.trigger({
        type: "risk_limit",
        detail: "second",
        triggeredAt: Date.now(),
      });
      expect(panic.getReason()?.detail).toBe("second");
    });
  });
});

describe("PanicStopController (Legacy)", () => {
  it("triggers safe mode and latches reason", () => {
    const safeMode = new SafeModeController();
    const panic = new PanicStopController(safeMode);
    panic.trigger({
      type: "vision_confidence",
      detail: "low confidence",
      triggeredAt: Date.now(),
    });
    expect(panic.isActive()).toBe(true);
    expect(safeMode.isActive()).toBe(true);
    expect(panic.getReason()?.detail).toBe("low confidence");
  });
});
