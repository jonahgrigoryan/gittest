import type { StrategyDecision } from "@poker-bot/shared/src/strategy";

interface VisionMetrics {
  lastConfidence: number;
  lastUpdated: number;
  lowConfidenceStreak: number;
  failureStreak: number;
}

interface SolverMetrics {
  lastLatency: number;
  lastUpdated: number;
  timedOutSamples: number;
  failureStreak: number;
}

interface ExecutorMetrics {
  total: number;
  failures: number;
  lastUpdated: number;
  failureStreak: number;
}

interface StrategyMetrics {
  lastDivergence: number;
  lastFallbackCount: number;
  lastUpdated: number;
  failureStreak: number;
}

export class HealthMetricsStore {
  private readonly vision: VisionMetrics = {
    lastConfidence: 1,
    lastUpdated: 0,
    lowConfidenceStreak: 0,
    failureStreak: 0
  };

  private readonly solver: SolverMetrics = {
    lastLatency: 0,
    lastUpdated: 0,
    timedOutSamples: 0,
    failureStreak: 0
  };

  private readonly executor: ExecutorMetrics = {
    total: 0,
    failures: 0,
    lastUpdated: 0,
    failureStreak: 0
  };

  private readonly strategy: StrategyMetrics = {
    lastDivergence: 0,
    lastFallbackCount: 0,
    lastUpdated: 0,
    failureStreak: 0
  };

  constructor(
    private readonly panicConfig: {
      visionConfidenceFrames: number;
      minConfidence: number;
    },
    private readonly triggerVisionPanic?: (detail: string) => void
  ) {}

  recordVisionSample(confidence: number, timestamp: number): void {
    this.vision.lastConfidence = confidence;
    this.vision.lastUpdated = timestamp;
    if (confidence < this.panicConfig.minConfidence) {
      this.vision.lowConfidenceStreak += 1;
      if (
        this.triggerVisionPanic &&
        this.vision.lowConfidenceStreak >= this.panicConfig.visionConfidenceFrames
      ) {
        this.triggerVisionPanic(
          `Vision confidence ${confidence.toFixed(3)} below ${this.panicConfig.minConfidence}`
        );
      }
    } else {
      this.vision.lowConfidenceStreak = 0;
    }
  }

  recordSolverSample(latencyMs: number, timedOut: boolean, timestamp: number): void {
    this.solver.lastLatency = latencyMs;
    this.solver.lastUpdated = timestamp;
    if (timedOut) {
      this.solver.timedOutSamples += 1;
    }
  }

  recordExecutorSample(success: boolean, timestamp: number): void {
    this.executor.lastUpdated = timestamp;
    this.executor.total += 1;
    if (!success) {
      this.executor.failures += 1;
    }
  }

  recordStrategySample(decision: StrategyDecision, timestamp: number): void {
    this.strategy.lastUpdated = timestamp;
    this.strategy.lastDivergence = decision.reasoning.divergence;
    this.strategy.lastFallbackCount = decision.reasoning.fallbackReason ? 1 : 0;
  }

  buildVisionStatus(threshold: number): {
    component: string;
    state: "healthy" | "degraded" | "failed";
    details?: string;
    metrics: Record<string, number>;
    consecutiveFailures: number;
  } {
    const age = Date.now() - this.vision.lastUpdated;
    let state: "healthy" | "degraded" | "failed" = "healthy";
    let details: string | undefined;
    if (age > 15_000) {
      state = "failed";
      details = "stale vision feed";
      this.vision.failureStreak += 1;
    } else if (this.vision.lastConfidence < threshold) {
      state = "degraded";
      details = `confidence ${this.vision.lastConfidence.toFixed(3)} < ${threshold}`;
      this.vision.failureStreak += 1;
    } else {
      this.vision.failureStreak = 0;
    }
    return {
      component: "vision",
      state,
      details,
      metrics: {
        confidence: this.vision.lastConfidence,
        lowConfidenceStreak: this.vision.lowConfidenceStreak
      },
      consecutiveFailures: this.vision.failureStreak
    };
  }

  buildSolverStatus(latencyThreshold: number): {
    component: string;
    state: "healthy" | "degraded" | "failed";
    details?: string;
    metrics: Record<string, number>;
    consecutiveFailures: number;
  } {
    const age = Date.now() - this.solver.lastUpdated;
    let state: "healthy" | "degraded" | "failed" = "healthy";
    let details: string | undefined;
    if (age > 30_000) {
      state = "degraded";
      details = "solver stats stale";
      this.solver.failureStreak += 1;
    } else if (this.solver.lastLatency > latencyThreshold) {
      state = "degraded";
      details = `latency ${this.solver.lastLatency}ms > ${latencyThreshold}ms`;
      this.solver.failureStreak += 1;
    } else if (this.solver.timedOutSamples > 0) {
      state = "degraded";
      details = "recent solver timeout";
      this.solver.failureStreak += 1;
    } else {
      this.solver.failureStreak = 0;
    }
    this.solver.timedOutSamples = 0;
    return {
      component: "solver",
      state,
      details,
      metrics: {
        latencyMs: this.solver.lastLatency
      },
      consecutiveFailures: this.solver.failureStreak
    };
  }

  buildExecutorStatus(failureThreshold: number): {
    component: string;
    state: "healthy" | "degraded" | "failed";
    details?: string;
    metrics: Record<string, number>;
    consecutiveFailures: number;
  } {
    const age = Date.now() - this.executor.lastUpdated;
    let state: "healthy" | "degraded" | "failed" = "healthy";
    let details: string | undefined;
    const failureRate =
      this.executor.total === 0 ? 0 : this.executor.failures / this.executor.total;
    if (age > 30_000) {
      state = "degraded";
      details = "executor idle";
      this.executor.failureStreak += 1;
    } else if (failureRate > failureThreshold) {
      state = "degraded";
      details = `failure rate ${(failureRate * 100).toFixed(1)}% > ${
        failureThreshold * 100
      }%`;
      this.executor.failureStreak += 1;
    } else {
      this.executor.failureStreak = 0;
    }
    this.executor.total = Math.min(this.executor.total, 100);
    this.executor.failures = Math.min(this.executor.failures, this.executor.total);
    return {
      component: "executor",
      state,
      details,
      metrics: {
        failureRate
      },
      consecutiveFailures: this.executor.failureStreak
    };
  }

  buildStrategyStatus(): {
    component: string;
    state: "healthy" | "degraded" | "failed";
    details?: string;
    metrics: Record<string, number>;
    consecutiveFailures: number;
  } {
    const age = Date.now() - this.strategy.lastUpdated;
    let state: "healthy" | "degraded" | "failed" = "healthy";
    let details: string | undefined;
    if (age > 60_000) {
      state = "degraded";
      details = "strategy stats stale";
      this.strategy.failureStreak += 1;
    } else if (this.strategy.lastDivergence > 30) {
      state = "degraded";
      details = `divergence ${this.strategy.lastDivergence.toFixed(1)}pp`;
      this.strategy.failureStreak += 1;
    } else if (this.strategy.lastFallbackCount > 0) {
      state = "degraded";
      details = "recent fallback";
      this.strategy.failureStreak += 1;
    } else {
      this.strategy.failureStreak = 0;
    }
    this.strategy.lastFallbackCount = 0;
    return {
      component: "strategy",
      state,
      details,
      metrics: {
        divergence: this.strategy.lastDivergence
      },
      consecutiveFailures: this.strategy.failureStreak
    };
  }
}
