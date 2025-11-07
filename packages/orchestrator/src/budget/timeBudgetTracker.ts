import { performance } from "node:perf_hooks";
import {
  DEFAULT_BUDGET_ALLOCATION,
  DEFAULT_TOTAL_BUDGET_MS,
  type BudgetAllocation,
  type BudgetComponent,
  type BudgetMetrics,
  type TimeBudgetTrackerOptions,
} from "./types";

const DEFAULT_METRICS_WINDOW = 200;
const COMPONENT_ORDER: BudgetComponent[] = ["perception", "gto", "agents", "synthesis", "execution", "buffer"];

interface RecordActualOptions {
  finalize?: boolean;
}

function createNumericMap(initial = 0): Record<BudgetComponent, number> {
  return COMPONENT_ORDER.reduce((acc, component) => {
    acc[component] = initial;
    return acc;
  }, {} as Record<BudgetComponent, number>);
}

function createMetricsMap(): Record<BudgetComponent, number[]> {
  return COMPONENT_ORDER.reduce((acc, component) => {
    acc[component] = [];
    return acc;
  }, {} as Record<BudgetComponent, number[]>);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export class TimeBudgetTracker {
  private readonly nowFn: () => number;
  private readonly metricsWindowSize: number;
  private readonly logger?: TimeBudgetTrackerOptions["logger"];
  private readonly totalBudgetMs: number;
  private readonly baseAllocation: BudgetAllocation;

  private allocation: BudgetAllocation;
  private startTime: number | null = null;
  private componentStartTimes: Partial<Record<BudgetComponent, number>> = {};
  private usage: Record<BudgetComponent, number> = createNumericMap(0);
  private pendingReservations: Record<BudgetComponent, number> = createNumericMap(0);
  private metrics: Record<BudgetComponent, number[]> = createMetricsMap();

  constructor(options: TimeBudgetTrackerOptions = {}) {
    this.nowFn = options.now ?? (() => performance.now());
    this.metricsWindowSize = options.metricsWindowSize ?? DEFAULT_METRICS_WINDOW;
    this.logger = options.logger;
    this.totalBudgetMs = options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
    this.baseAllocation = {
      ...DEFAULT_BUDGET_ALLOCATION,
      ...options.allocation,
    };
    this.allocation = { ...this.baseAllocation };
  }

  start(): void {
    this.ensureStarted();
  }

  startComponent(component: BudgetComponent): void {
    this.ensureStarted();
    this.componentStartTimes[component] = this.now();
  }

  endComponent(component: BudgetComponent): number {
    const start = this.componentStartTimes[component];
    delete this.componentStartTimes[component];
    if (start == null) {
      return 0;
    }
    const duration = Math.max(0, this.now() - start);
    this.recordActual(component, duration);
    return duration;
  }

  elapsed(): number {
    if (this.startTime == null) {
      return 0;
    }
    return Math.max(0, this.now() - this.startTime);
  }

  remaining(component?: BudgetComponent): number {
    if (!component) {
      return Math.max(0, this.totalBudgetMs - this.elapsed());
    }
    const limit = this.allocation[component] ?? 0;
    const used = this.usage[component] ?? 0;
    const reserved = this.pendingReservations[component] ?? 0;
    return Math.max(0, limit - used - reserved);
  }

  reserve(component: BudgetComponent, durationMs: number): boolean {
    this.ensureStarted();
    if (durationMs <= 0) {
      return true;
    }
    const available = this.remaining(component);
    if (available < durationMs) {
      return false;
    }
    this.pendingReservations[component] += durationMs;
    return true;
  }

  release(component: BudgetComponent, durationMs: number): void {
    const pending = this.pendingReservations[component];
    if (pending == null) {
      return;
    }
    this.pendingReservations[component] = Math.max(0, pending - durationMs);
  }

  shouldPreempt(component: BudgetComponent): boolean {
    if (this.elapsed() >= this.totalBudgetMs) {
      return true;
    }
    const start = this.componentStartTimes[component];
    if (start == null) {
      return this.remaining(component) <= 0;
    }
    const componentElapsed = this.now() - start;
    const usedBefore = this.usage[component] ?? 0;
    const limit = this.allocation[component] ?? 0;
    return componentElapsed + usedBefore >= limit;
  }

  recordActual(component: BudgetComponent, durationMs: number, options: RecordActualOptions = {}): void {
    this.ensureStarted();
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }
    const { finalize = true } = options;
    const limit = this.allocation[component] ?? 0;
    const priorUsage = this.usage[component] ?? 0;
    const remainingBefore = Math.max(0, limit - priorUsage);
    this.consumePending(component, durationMs);
    this.usage[component] = priorUsage + durationMs;
    this.pushMetric(component, durationMs);
    if (remainingBefore <= 0) {
      this.applyOverrun(component, durationMs);
      return;
    }
    if (durationMs > remainingBefore) {
      this.applyOverrun(component, durationMs - remainingBefore);
      return;
    }
    if (finalize) {
      const surplus = remainingBefore - durationMs;
      if (surplus > 0) {
        this.returnToBuffer(surplus);
      }
    }
  }

  allocationSnapshot(): BudgetAllocation {
    return { ...this.allocation };
  }

  metricsSnapshot(component: BudgetComponent): BudgetMetrics {
    const history = this.metrics[component] ?? [];
    if (history.length === 0) {
      return {
        samples: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        lastSample: 0,
      };
    }
    const sorted = [...history].sort((a, b) => a - b);
    return {
      samples: history.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      lastSample: history[history.length - 1],
    };
  }

  private ensureStarted(): void {
    if (this.startTime == null) {
      this.startTime = this.now();
    }
  }

  private now(): number {
    return this.nowFn();
  }

  private consumePending(component: BudgetComponent, durationMs: number): void {
    const pending = this.pendingReservations[component];
    if (pending <= 0) {
      return;
    }
    const reduction = Math.min(durationMs, pending);
    this.pendingReservations[component] = pending - reduction;
  }

  private pushMetric(component: BudgetComponent, durationMs: number): void {
    const history = this.metrics[component];
    history.push(durationMs);
    if (history.length > this.metricsWindowSize) {
      history.splice(0, history.length - this.metricsWindowSize);
    }
  }

  private applyOverrun(component: BudgetComponent, delta: number): void {
    let remaining = this.consumeBuffer(delta);
    const startIndex = COMPONENT_ORDER.indexOf(component);
    for (let idx = startIndex + 1; idx < COMPONENT_ORDER.length && remaining > 0; idx += 1) {
      const downstream = COMPONENT_ORDER[idx];
      if (downstream === "buffer") {
        continue;
      }
      const recovered = this.reduceBudget(downstream, remaining);
      remaining -= recovered;
    }
    if (remaining > 0) {
      this.logger?.warn?.("TimeBudgetTracker: exhausted all downstream budgets after overrun", {
        component,
        remaining,
      });
    }
  }

  private consumeBuffer(delta: number): number {
    if (delta <= 0) {
      return 0;
    }
    const available = Math.max(0, this.allocation.buffer);
    const consumed = Math.min(delta, available);
    this.allocation.buffer = available - consumed;
    return delta - consumed;
  }

  private reduceBudget(component: BudgetComponent, desired: number): number {
    const limit = this.allocation[component] ?? 0;
    const used = this.usage[component] ?? 0;
    const headroom = Math.max(0, limit - used);
    if (headroom <= 0) {
      return 0;
    }
    const applied = Math.min(desired, headroom);
    this.allocation[component] = limit - applied;
    return applied;
  }

  private returnToBuffer(surplus: number): void {
    if (surplus <= 0) {
      return;
    }
    const headroom = Math.max(0, this.baseAllocation.buffer - this.allocation.buffer);
    if (headroom <= 0) {
      return;
    }
    const applied = Math.min(surplus, headroom);
    this.allocation.buffer += applied;
  }
}

export type { BudgetAllocation, BudgetComponent, BudgetMetrics } from "./types";
export { DEFAULT_BUDGET_ALLOCATION, DEFAULT_TOTAL_BUDGET_MS };
