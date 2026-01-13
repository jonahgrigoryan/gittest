import { describe, it, expect, vi, afterEach } from "vitest";
import { SafeModeController } from "../../src/health/safeModeController";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SafeModeController", () => {
  describe("Phase 11: Idempotent Transitions", () => {
    it("enters safe mode with a reason", () => {
      const controller = new SafeModeController();
      expect(controller.isActive()).toBe(false);
      controller.enter("test reason");
      expect(controller.isActive()).toBe(true);
      const state = controller.getState();
      expect(state.active).toBe(true);
      expect(state.reason).toBe("test reason");
      expect(state.enteredAt).toBeDefined();
      expect(state.manual).toBe(false);
    });

    it("idempotent: enter() called twice with same reason preserves first reason", () => {
      const controller = new SafeModeController();
      const nowSpy = vi.spyOn(Date, "now");
      const firstEnteredAt = 1000;
      nowSpy.mockReturnValue(firstEnteredAt);

      controller.enter("first reason");

      const secondEnteredAt = firstEnteredAt + 1000;
      nowSpy.mockReturnValue(secondEnteredAt);
      controller.enter("second reason");

      const state = controller.getState();
      expect(state.active).toBe(true);
      expect(state.reason).toBe("first reason");
      expect(state.enteredAt).toBe(firstEnteredAt);
    });

    it("idempotent: enter() called twice with different reason preserves first reason", () => {
      const controller = new SafeModeController();
      controller.enter("initial reason");
      expect(controller.getState().reason).toBe("initial reason");
      controller.enter("different reason");
      expect(controller.getState().reason).toBe("initial reason");
    });

    it("exit() when not active is no-op", () => {
      const controller = new SafeModeController();
      const initialState = controller.getState();
      expect(controller.isActive()).toBe(false);

      controller.exit();
      controller.exit(true);

      const state = controller.getState();
      expect(state.active).toBe(false);
      expect(state).toEqual(initialState);
    });

    it("manual entry requires manual exit", () => {
      const controller = new SafeModeController();
      controller.enter("manual reason", { manual: true });
      expect(controller.isActive()).toBe(true);

      controller.exit();
      expect(controller.isActive()).toBe(true);

      controller.exit(true);
      expect(controller.isActive()).toBe(false);
    });

    it("auto entry allows auto exit", () => {
      const controller = new SafeModeController();
      controller.enter("auto reason");
      expect(controller.isActive()).toBe(true);

      controller.exit();
      expect(controller.isActive()).toBe(false);
    });

    it("latches reason correctly", () => {
      const controller = new SafeModeController();
      controller.enter("latched reason");
      const state = controller.getState();
      expect(state.reason).toBe("latched reason");
      expect(state.active).toBe(true);
    });

    it("preserves enteredAt timestamp on idempotent enter", () => {
      const controller = new SafeModeController();
      const nowSpy = vi.spyOn(Date, "now");
      nowSpy.mockReturnValue(1000);
      controller.enter("reason");
      const firstTimestamp = controller.getState().enteredAt;

      nowSpy.mockReturnValue(2000);
      controller.enter("new reason");

      expect(controller.getState().enteredAt).toBe(firstTimestamp);
    });
  });
});

describe("SafeModeController (Legacy)", () => {
  it("enters and exits safe mode", () => {
    const controller = new SafeModeController();
    expect(controller.isActive()).toBe(false);
    controller.enter("test");
    expect(controller.isActive()).toBe(true);
    controller.exit();
    expect(controller.isActive()).toBe(false);
  });

  it("requires manual exit when manually entered", () => {
    const controller = new SafeModeController();
    controller.enter("manual", { manual: true });
    expect(controller.isActive()).toBe(true);
    controller.exit();
    expect(controller.isActive()).toBe(true);
    controller.exit(true);
    expect(controller.isActive()).toBe(false);
  });
});
