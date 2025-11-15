import { describe, it, expect } from "vitest";
import { SafeModeController } from "../../src/health/safeModeController";
import { PanicStopController } from "../../src/health/panicStopController";

describe("PanicStopController", () => {
  it("triggers safe mode and latches reason", () => {
    const safeMode = new SafeModeController();
    const panic = new PanicStopController(safeMode);
    panic.trigger({
      type: "vision_confidence",
      detail: "low confidence",
      triggeredAt: Date.now()
    });
    expect(panic.isActive()).toBe(true);
    expect(safeMode.isActive()).toBe(true);
    expect(panic.getReason()?.detail).toBe("low confidence");
  });
});
