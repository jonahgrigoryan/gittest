import { describe, it, expect } from "vitest";
import { run } from "../src/main";
import { TimeBudgetTracker } from "../src/budget/timeBudgetTracker";

describe("orchestrator", () => {
  it("runs without contacting solver", async () => {
    const res = await run();
    expect(res.ok).toBe(true);
    const tracker = res.budget.createTracker();
    expect(tracker).toBeInstanceOf(TimeBudgetTracker);
  }, 15000);
});
