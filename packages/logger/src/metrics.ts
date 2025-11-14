import { createActionKey } from "@poker-bot/shared";
import type { HandRecord, SessionMetrics } from "@poker-bot/shared";
import type { MetricsConfig } from "./types";

class RingBuffer {
  private values: number[] = [];
  private index = 0;

  constructor(private readonly capacity: number) {}

  push(value: number | undefined) {
    if (!Number.isFinite(value)) {
      return;
    }
    if (this.values.length < this.capacity) {
      this.values.push(value as number);
    } else {
      this.values[this.index] = value as number;
      this.index = (this.index + 1) % this.capacity;
    }
  }

  mean(): number {
    if (this.values.length === 0) {
      return 0;
    }
    const sum = this.values.reduce((acc, value) => acc + value, 0);
    return sum / this.values.length;
  }

  quantile(percentile: number): number {
    if (this.values.length === 0) {
      return 0;
    }
    const sorted = [...this.values].sort((a, b) => a - b);
    const clamped = Math.min(Math.max(percentile, 0), 1);
    const index = Math.min(
      sorted.length - 1,
      Math.round(clamped * (sorted.length - 1))
    );
    return sorted[index];
  }
}

export class MetricsCollector {
  private readonly winRate: RingBuffer;
  private readonly evAccuracy: RingBuffer;
  private readonly divergence: RingBuffer;
  private readonly latency: {
    gto: RingBuffer;
    agents: RingBuffer;
    execution: RingBuffer;
    total: RingBuffer;
  };
  private totalHands = 0;
  private riskFallbacks = 0;
  private gtoFallbacks = 0;

  constructor(private readonly config: MetricsConfig) {
    const capacity = Math.max(1, config.windowHands);
    this.winRate = new RingBuffer(capacity);
    this.evAccuracy = new RingBuffer(capacity);
    this.divergence = new RingBuffer(capacity);
    this.latency = {
      gto: new RingBuffer(capacity),
      agents: new RingBuffer(capacity),
      execution: new RingBuffer(capacity),
      total: new RingBuffer(capacity)
    };
  }

  record(hand: HandRecord) {
    if (!this.config.enabled) {
      return;
    }
    this.totalHands += 1;
    this.latency.gto.push(hand.decision.timing.gtoTime);
    this.latency.agents.push(hand.decision.timing.agentTime);
    this.latency.total.push(hand.decision.timing.totalTime);
    if (hand.execution?.timing) {
      this.latency.execution.push(hand.execution.timing.totalMs);
    }

    if (hand.outcome) {
      const bigBlind = hand.rawGameState.blinds.big || 1;
      const bbWin = hand.outcome.netChips / bigBlind;
      this.winRate.push(bbWin);
    }

    if (hand.solver?.actions?.length) {
      const chosenKey = createActionKey(hand.decision.action);
      const chosenAction = hand.solver.actions.find(
        entry => entry.actionKey === chosenKey
      );
      const bestEv = Math.max(...hand.solver.actions.map(entry => entry.ev ?? 0));
      const chosenEv = chosenAction?.ev ?? bestEv;
      this.evAccuracy.push(chosenEv - bestEv);
    }

    this.divergence.push(hand.decision.reasoning.divergence);

    if (hand.decision.metadata.panicStop) {
      this.riskFallbacks += 1;
    }

    if (hand.decision.metadata.usedGtoOnlyFallback) {
      this.gtoFallbacks += 1;
    }
  }

  snapshot(sessionId: string): SessionMetrics {
    return {
      sessionId,
      handsLogged: this.totalHands,
      winRateBb100: this.winRate.mean() * 100,
      evAccuracy: {
        meanDelta: this.evAccuracy.mean(),
        p50Delta: this.evAccuracy.quantile(0.5),
        p95Delta: this.evAccuracy.quantile(0.95),
        p99Delta: this.evAccuracy.quantile(0.99)
      },
      latency: {
        gto: quantiles(this.latency.gto),
        agents: quantiles(this.latency.agents),
        execution: quantiles(this.latency.execution),
        total: quantiles(this.latency.total)
      },
      decisionQuality: {
        divergenceMean: this.divergence.mean(),
        riskFallbackCount: this.riskFallbacks,
        gtoOnlyFallbackCount: this.gtoFallbacks
      },
      computedAt: Date.now()
    };
  }
}

function quantiles(buffer: RingBuffer) {
  return {
    p50: buffer.quantile(0.5),
    p95: buffer.quantile(0.95),
    p99: buffer.quantile(0.99)
  };
}
