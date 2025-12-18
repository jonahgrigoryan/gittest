import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { StrategyDecision } from "@poker-bot/shared";
import type { HandMetric, EvaluationAggregateReport } from "@poker-bot/shared";
import { createEvaluationReport } from "@poker-bot/shared";
import { MinimalSimulator } from "../simulator/minimal";
import { getOpponentDefinition } from "../opponents/registry";
import type { OpponentDefinition } from "../opponents/types";
import type {
  EvaluationRunner,
  EvaluationContext,
  EvaluationDataSink,
} from "../types";

export interface DecisionRequestContext {
  runId: string;
  handIndex: number;
  opponentId: string;
  rng: () => number;
  bigBlind: number;
}

export interface DecisionProvider {
  nextDecision(
    handId: string,
    context: DecisionRequestContext,
  ): Promise<StrategyDecision>;
}

export interface HarnessOptions {
  decisionProvider: DecisionProvider;
  metricsDir?: string;
  simulatorFactory?: (config: { bigBlind: number }) => MinimalSimulator;
  rngSeed?: number;
  sink?: EvaluationDataSink;
  opponentProfiles?: Record<
    string,
    { aggressionFactor: number; bluffFrequency: number; style?: string }
  >;
}

export class EvaluationHarness implements EvaluationRunner {
  constructor(private readonly options: HarnessOptions) {}

  async run(context: EvaluationContext): Promise<EvaluationAggregateReport> {
    const metrics: HandMetric[] = [];
    const startedAt = Date.now();
    const rng = createMulberry32(
      context.config.seed ?? this.options.rngSeed ?? Date.now(),
    );
    const simulator = this.options.simulatorFactory
      ? this.options.simulatorFactory({ bigBlind: 2 })
      : new MinimalSimulator({ bigBlind: 2 });
    const bigBlind = simulator.getBigBlind();
    const opponents = context.config.opponents.length
      ? context.config.opponents
      : ["tight_aggressive"];
    const sink =
      this.options.sink ??
      (await createFileSink(context.runId, this.options.metricsDir));

    for (let i = 0; i < context.config.maxHands; i += 1) {
      const opponentId = opponents[i % opponents.length];
      const decision = await this.options.decisionProvider.nextDecision(
        `${context.runId}-${i}`,
        {
          runId: context.runId,
          handIndex: i,
          opponentId,
          rng,
          bigBlind,
        },
      );
      const profile = this.options.opponentProfiles?.[opponentId];
      const opponent = profile?.style
        ? getOpponentDefinition(profile.style)
        : getOpponentDefinition(opponentId);
      if (!opponent && !profile) {
        throw new Error(`Unknown opponent: ${opponentId}`);
      }
      const opponentAction = (opponent?.policy ?? defaultPolicy)({
        pot: 2,
        aggressionFactor: profile?.aggressionFactor ?? 1,
        bluffFrequency: profile?.bluffFrequency ?? 0.1,
        rng,
      });
      const result = simulator.playHand(decision, opponentAction);
      const metric: HandMetric = {
        handId: decision.metadata?.rngSeed
          ? `${decision.metadata.rngSeed}`
          : `${context.runId}-${i}`,
        opponentId,
        netChips: result.netChips,
        bigBlind,
      };
      metrics.push(metric);
      await sink.writeHandMetric(metric);
    }

    await sink.flush();

    return createEvaluationReport(context.config, metrics, {
      metricsPath: getMetricsPath(context.runId, this.options.metricsDir),
      startedAt,
      completedAt: Date.now(),
      runId: context.runId,
    });
  }
}

class FileMetricSink implements EvaluationDataSink {
  constructor(private readonly filePath: string) {}

  async writeHandMetric(metric: HandMetric): Promise<void> {
    await appendFile(this.filePath, `${JSON.stringify(metric)}\n`, "utf-8");
  }

  async flush(): Promise<void> {
    // no-op for append-only sink
  }
}

async function createFileSink(
  runId: string,
  metricsDir?: string,
): Promise<FileMetricSink> {
  const dir =
    metricsDir ?? path.resolve(process.cwd(), "../../results/eval", runId);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "metrics.jsonl");
  return new FileMetricSink(filePath);
}

function getMetricsPath(runId: string, metricsDir?: string) {
  const dir =
    metricsDir ?? path.resolve(process.cwd(), "../../results/eval", runId);
  return path.join(dir, "metrics.jsonl");
}

function createMulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const defaultPolicy: OpponentDefinition["policy"] = ({
  pot,
  aggressionFactor,
  bluffFrequency,
  rng,
}) => {
  if (rng() < bluffFrequency) {
    return { action: "raise", amount: pot * Math.max(aggressionFactor, 1) };
  }
  return rng() < aggressionFactor / 2 ? { action: "call" } : { action: "fold" };
};
