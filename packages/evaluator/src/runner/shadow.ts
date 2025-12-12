import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { HandRecord } from "@poker-bot/shared";
import { nanoid } from "nanoid";
import {
  readHandRecords,
  resolveSessionFile,
  ensureOutputDir,
} from "../util/records";
import type { EvaluationSummary, ShadowEvaluationOptions } from "../types";

export async function runShadowEvaluation(
  options: ShadowEvaluationOptions,
): Promise<EvaluationSummary> {
  const runId = options.runId ?? `shadow-${nanoid(8)}`;
  const sourceFile = await resolveSessionFile(
    options.handsDir,
    options.sessionId,
  );
  const limit = options.limit ?? Number.POSITIVE_INFINITY;

  const aggregates = {
    totalHands: 0,
    fallbackCount: 0,
    safeActionCount: 0,
    confidenceTotal: 0,
    netChips: 0,
  };
  const fallbackReasons: Record<string, number> = {};
  const perHand: HandRecord[] = [];

  for await (const record of readHandRecords(sourceFile)) {
    aggregates.totalHands += 1;
    const fallbackKey =
      record.decision?.reasoning?.fallbackReason ??
      (record.decision as { fallbackReason?: string } | undefined)
        ?.fallbackReason;
    if (fallbackKey) {
      aggregates.fallbackCount += 1;
      fallbackReasons[fallbackKey] = (fallbackReasons[fallbackKey] ?? 0) + 1;
      if (fallbackKey.includes("safe_action")) {
        aggregates.safeActionCount += 1;
      }
    }
    const confidence = (record.decision as { confidence?: number } | undefined)
      ?.confidence;
    if (typeof confidence === "number") {
      aggregates.confidenceTotal += confidence;
    }
    const net =
      record.outcome?.netChips ??
      (record.outcome as { net?: number } | undefined)?.net;
    if (net !== undefined) {
      aggregates.netChips += net;
    }
    perHand.push(record);
    if (aggregates.totalHands >= limit) {
      break;
    }
  }

  if (aggregates.totalHands === 0) {
    throw new Error(`No hands read from ${sourceFile}`);
  }

  const summary: EvaluationSummary = {
    metadata: {
      runId,
      mode: "shadow",
      startedAt: Date.now(),
      completedAt: Date.now(),
      sessionId: options.sessionId,
      handsProcessed: aggregates.totalHands,
      handsLimit: Number.isFinite(limit) ? limit : undefined,
      sourcePath: sourceFile,
    },
    aggregates: {
      totalHands: aggregates.totalHands,
      fallbackCount: aggregates.fallbackCount,
      safeActionCount: aggregates.safeActionCount,
      averageConfidence: aggregates.confidenceTotal / aggregates.totalHands,
      netChips: aggregates.netChips,
    },
    fallbackReasons,
  };

  const outputDir = await ensureOutputDir(options.outputDir, runId);
  const summaryPath = path.join(outputDir, "summary.json");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  return summary;
}
