import type { EvaluationRunner, EvaluationContext } from "../types";
import { EvaluationHarness, type HarnessOptions } from "./harness";

export class OfflineSmokeRunner implements EvaluationRunner {
  private readonly harness: EvaluationHarness;

  constructor(options: HarnessOptions) {
    this.harness = new EvaluationHarness(options);
  }

  run(context: EvaluationContext) {
    return this.harness.run(context);
  }
}

export class OfflineSuiteRunner extends OfflineSmokeRunner {}
