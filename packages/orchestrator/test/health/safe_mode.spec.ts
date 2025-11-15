import { describe, it, expect } from "vitest";
import { SafeModeController } from "../../src/health/safeModeController";

describe("SafeModeController", () => {
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
    controller.exit(); // auto exit blocked
    expect(controller.isActive()).toBe(true);
    controller.exit(true);
    expect(controller.isActive()).toBe(false);
  });
});
