import type { EvaluationRunConfig, EvaluationAggregateReport, HandMetric } from "@poker-bot/shared";

export interface EvaluationContext {
  config: EvaluationRunConfig;
  runId: string;
}

export interface EvaluationRunner {
  run(context: EvaluationContext): Promise<EvaluationAggregateReport>;
}

export interface EvaluationDataSink {
  writeHandMetric(metric: HandMetric): Promise<void>;
  flush(): Promise<void>;
}
