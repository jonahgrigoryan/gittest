import { describe, it, expect } from "vitest";
import {
  TimeBudgetTracker,
  DEFAULT_BUDGET_ALLOCATION,
  type BudgetAllocation,
} from "../../src/budget/timeBudgetTracker";

function createTracker(overrides: Partial<BudgetAllocation> = {}) {
  let now = 0;
  const tracker = new TimeBudgetTracker({
    allocation: overrides,
    now: () => now,
  });
  return {
    tracker,
    advance: (delta: number) => {
      now += delta;
    },
  };
}

describe("TimeBudgetTracker", () => {
  it("tracks elapsed time and reservations", () => {
    const { tracker, advance } = createTracker();
    tracker.start();
    expect(tracker.remaining("agents")).toBe(DEFAULT_BUDGET_ALLOCATION.agents);
    expect(tracker.reserve("agents", 500)).toBe(true);
    expect(tracker.remaining("agents")).toBe(DEFAULT_BUDGET_ALLOCATION.agents - 500);
    expect(tracker.reserve("agents", DEFAULT_BUDGET_ALLOCATION.agents)).toBe(false);

    tracker.startComponent("gto");
    advance(100);
    tracker.endComponent("gto");
    expect(tracker.remaining()).toBeGreaterThan(0);
  });

  it("preempts components that exceed allocation", () => {
    const { tracker, advance } = createTracker();
    tracker.start();
    tracker.startComponent("gto");
    advance(200);
    expect(tracker.shouldPreempt("gto")).toBe(false);
    advance(250);
    expect(tracker.shouldPreempt("gto")).toBe(true);
    tracker.endComponent("gto");
  });

  it("reduces downstream budgets when perception overruns and replenishes buffer on surplus", () => {
    const { tracker } = createTracker({ buffer: 0 });
    tracker.recordActual("perception", 170);
    const snapshotAfterOverrun = tracker.allocationSnapshot();
    expect(snapshotAfterOverrun.gto).toBe(DEFAULT_BUDGET_ALLOCATION.gto - 100);

    tracker.recordActual("gto", 200, { finalize: false });
    tracker.recordActual("gto", 100, { finalize: false });
    tracker.recordActual("gto", 50); // finishes under remaining allocation
    const finalSnapshot = tracker.allocationSnapshot();
    expect(finalSnapshot.buffer).toBe(0);
  });

  it("only returns surplus to buffer when finalize=true", () => {
    const { tracker } = createTracker();
    tracker.recordActual("perception", 150);
    const afterPerception = tracker.allocationSnapshot();
    expect(afterPerception.buffer).toBe(DEFAULT_BUDGET_ALLOCATION.buffer - 80);

    tracker.recordActual("gto", 100, { finalize: false });
    expect(tracker.allocationSnapshot().buffer).toBe(afterPerception.buffer);

    tracker.recordActual("gto", 50);
    expect(tracker.allocationSnapshot().buffer).toBe(DEFAULT_BUDGET_ALLOCATION.buffer);
  });

  it("collects metrics for percentile analysis", () => {
    const { tracker } = createTracker();
    tracker.recordActual("agents", 1000);
    tracker.recordActual("agents", 1100);
    tracker.recordActual("agents", 900);

    const metrics = tracker.metricsSnapshot("agents");
    expect(metrics.samples).toBe(3);
    expect(metrics.p50).toBeGreaterThan(900);
    expect(metrics.p99).toBeGreaterThan(metrics.p95);
    expect(metrics.lastSample).toBe(900);
  });
});
