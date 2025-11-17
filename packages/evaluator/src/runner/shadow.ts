import path from "node:path";
import type { EvaluationAggregateReport } from "@poker-bot/shared";
import { createEvaluationReport } from "@poker-bot/shared";
import { readHandRecords, findHandRecordFile } from "@poker-bot/orchestrator/src/replay/reader";
import type { EvaluationRunner, EvaluationContext } from "../types";

export class ShadowModeRunner implements EvaluationRunner {
  constructor(private readonly options: { sessionsRoot?: string; sessionId?: string; filePath?: string }) {}

  async run(context: EvaluationContext): Promise<EvaluationAggregateReport> {
    const dir = this.options.sessionsRoot ?? path.resolve(process.cwd(), "../../results/hands");
    const resolved =
      this.options.filePath ??
      (await findHandRecordFile(this.options.sessionId ?? context.config.opponents[0] ?? "", dir));
    if (!resolved) {
      throw new Error("ShadowModeRunner: unable to locate hand records for session");
    }
    const filePath = resolved;
    const metrics: { handId: string; opponentId: string; netChips: number; bigBlind: number }[] = [];
    for await (const record of readHandRecords(filePath, { limit: context.config.maxHands })) {
      if (!record.outcome) {
        continue;
      }
      metrics.push({
        handId: record.handId,
        opponentId: record.metadata.modelVersions?.llm ? Object.keys(record.metadata.modelVersions.llm)[0] : "unknown",
        netChips: record.outcome.netChips,
        bigBlind: record.rawGameState.blinds.big ?? 1
      });
    }

    return createEvaluationReport(context.config, metrics, {
      metricsPath: filePath,
      startedAt: Date.now() - 1,
      completedAt: Date.now(),
      runId: context.runId
    });
  }
}
