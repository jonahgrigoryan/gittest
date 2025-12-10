import type {
  EvaluationAggregateReport,
  EvaluationRunConfig,
  HandMetric,
  HandRecord
} from "@poker-bot/shared";

export interface EvaluationContext {
  runId: string;
  config: EvaluationRunConfig;
}

export interface EvaluationDataSink {
  writeHandMetric(metric: HandMetric): Promise<void>;
  flush(): Promise<void>;
}

export interface EvaluationRunner {
  run(context: EvaluationContext): Promise<EvaluationAggregateReport>;
}

export interface EvaluationRunMetadata {
  runId: string;
  mode: "shadow" | "smoke";
  startedAt: number;
  completedAt?: number;
  sessionId?: string;
  handsProcessed: number;
  handsLimit?: number;
  sourcePath: string;
}

export interface EvaluationSummary {
  metadata: EvaluationRunMetadata;
  aggregates: {
    totalHands: number;
    fallbackCount: number;
    safeActionCount: number;
    averageConfidence: number;
    netChips: number;
  };
  fallbackReasons: Record<string, number>;
}

export interface HandRecordSummary {
  handId: string;
  actionType: string;
  fallbackReason?: string;
  confidence?: number;
  netChips?: number;
}

export interface ShadowEvaluationOptions {
  sessionId?: string;
  handsDir: string;
  outputDir: string;
  limit?: number;
  runId?: string;
}

export interface HandRecordReader {
  (filePath: string): AsyncGenerator<HandRecord>;
}
