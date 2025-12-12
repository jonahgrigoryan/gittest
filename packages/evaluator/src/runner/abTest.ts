import type { EvaluationAggregateReport } from "@poker-bot/shared/src/evaluation";
import type { EvaluationRunner, EvaluationContext } from "../types";
import { EvaluationHarness, type HarnessOptions } from "./harness";

export class ABTestRunner implements EvaluationRunner {
  constructor(private readonly optionsA: HarnessOptions, private readonly optionsB: HarnessOptions) {}

  async run(context: EvaluationContext): Promise<EvaluationAggregateReport> {
    const variantA = new EvaluationHarness(this.optionsA);
    const variantB = new EvaluationHarness(this.optionsB);
    const [reportA, reportB] = await Promise.all([
      variantA.run({ ...context, runId: `${context.runId}-A` }),
      variantB.run({ ...context, runId: `${context.runId}-B` })
    ]);
    // Return combined summary referencing variant A stats for now
    return {
      ...reportA,
      opponents: [...new Set([...reportA.opponents, ...reportB.opponents])],
      winRateBb100: reportA.winRateBb100 - reportB.winRateBb100,
      winRateConfidenceInterval: [
        reportA.winRateConfidenceInterval[0] - reportB.winRateConfidenceInterval[1],
        reportA.winRateConfidenceInterval[1] - reportB.winRateConfidenceInterval[0]
      ]
    };
  }
}
