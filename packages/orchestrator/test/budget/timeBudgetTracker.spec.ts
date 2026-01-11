import { describe, it, expect } from "vitest";
import {
  TimeBudgetTracker,
  DEFAULT_BUDGET_ALLOCATION,
  type BudgetAllocation,
} from "../../src/budget/timeBudgetTracker";

function createTracker(
  overrides: Partial<BudgetAllocation> = {},
  opts: { totalBudgetMs?: number } = {},
) {
  let now = 0;
  const tracker = new TimeBudgetTracker({
    allocation: overrides,
    totalBudgetMs: opts.totalBudgetMs,
    now: () => now,
  });
  return {
    tracker,
    advance: (delta: number) => {
      now += delta;
    },
  };
}

const ALL_COMPONENTS = Object.keys(
  DEFAULT_BUDGET_ALLOCATION,
) as (keyof BudgetAllocation)[];

describe("TimeBudgetTracker", () => {
  it("tracks elapsed time and reservations", () => {
    const { tracker, advance } = createTracker();
    tracker.start();
    expect(tracker.remaining("agents")).toBe(DEFAULT_BUDGET_ALLOCATION.agents);
    expect(tracker.reserve("agents", 500)).toBe(true);
    expect(tracker.remaining("agents")).toBe(
      DEFAULT_BUDGET_ALLOCATION.agents - 500,
    );
    expect(tracker.reserve("agents", DEFAULT_BUDGET_ALLOCATION.agents)).toBe(
      false,
    );

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

  describe("Phase 9: Time Budget Hardening", () => {
    it("1) applyOverrun() cascade can reduce component budgets to 0 but never negative", () => {
      const { tracker } = createTracker({
        perception: 100,
        gto: 100,
        agents: 100,
        buffer: 0,
      });

      // Perception overruns by a massive amount (400 overrun)
      tracker.recordActual("perception", 500);

      const snapshot = tracker.allocationSnapshot();

      expect(tracker.remaining("perception")).toBe(0);
      expect(snapshot.gto).toBe(0);
      expect(snapshot.agents).toBe(0);
      expect(tracker.remaining()).toBeGreaterThanOrEqual(0);
    });

    it("2) Component allocation never goes negative", () => {
      const { tracker } = createTracker({
        perception: 10,
        gto: 10,
        buffer: 0,
      });

      tracker.reserve("perception", 20);
      tracker.startComponent("perception");
      tracker.endComponent("perception");

      tracker.recordActual("perception", 50);
      tracker.recordActual("gto", 50);

      const snapshot = tracker.allocationSnapshot();
      ALL_COMPONENTS.forEach((component) => {
        expect(snapshot[component]).toBeGreaterThanOrEqual(0);
        expect(tracker.remaining(component)).toBeGreaterThanOrEqual(0);
      });
      expect(tracker.remaining()).toBeGreaterThanOrEqual(0);
    });

    it("3) Preemption with <100ms remaining (global preempt)", () => {
      const { tracker, advance } = createTracker({}, { totalBudgetMs: 200 });
      tracker.start();

      advance(100); // remaining 100ms
      expect(tracker.shouldPreemptTotal(100)).toBe(false);

      advance(1); // remaining 99ms
      expect(tracker.shouldPreemptTotal(100)).toBe(true);

      advance(99); // remaining 0ms
      expect(tracker.shouldPreemptTotal(100)).toBe(true);
    });

    it("4) Downstream components never go negative when total budget hits 0", () => {
      const { tracker, advance } = createTracker(
        { gto: 50 },
        { totalBudgetMs: 100 },
      );
      tracker.start();

      advance(150);
      expect(tracker.remaining()).toBe(0);

      expect(tracker.remaining("gto")).toBe(0);
      expect(tracker.remaining("agents")).toBe(0);

      const snapshot = tracker.allocationSnapshot();
      expect(snapshot.gto).toBeGreaterThanOrEqual(0);
    });

    it("5) recordActual() with overrun cascades + remaining() clamps", () => {
      const { tracker } = createTracker({ perception: 10, gto: 50, buffer: 0 });

      tracker.reserve("perception", 10);
      tracker.recordActual("perception", 100);

      const snapshot = tracker.allocationSnapshot();
      expect(snapshot.gto).toBe(0);

      expect(tracker.remaining("gto")).toBe(0);
      expect(tracker.remaining("perception")).toBe(0);
      expect(tracker.remaining()).toBeGreaterThanOrEqual(0);
    });
  });
});
