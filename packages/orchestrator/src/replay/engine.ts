import { performance } from "node:perf_hooks";
import type {
  HandRecord,
  StrategyDecision,
  SerializedStrategyDecision,
  ModelVersions,
  ActionKey
} from "@poker-bot/shared";
import { deserializeGameState } from "./deserialize";
import type { ReplayResult, ReplayComparison, BatchReplayReport } from "@poker-bot/shared/src/replay";
import type { TimeBudgetTracker } from "../budget/timeBudgetTracker";
import type { AgentCoordinator } from "@poker-bot/agents";
import type { ConfigurationManager } from "@poker-bot/shared/src/config/manager";
import type { GTOSolver } from "../solver/solver";
import type { StrategyEngine } from "../strategy/engine";
import { makeDecision as runDecisionPipeline } from "../decision/pipeline";
import type { DecisionPipelineResult } from "../decision/pipeline";
import { ModelVersionValidator, type ModelVersionMismatch } from "./model_validator";
import type { ReadHandRecordsOptions } from "./reader";
import { readHandRecords } from "./reader";

export interface ReplayEngineDeps {
  configManager: ConfigurationManager;
  gtoSolver: GTOSolver;
  strategyEngine: StrategyEngine;
  agentCoordinator?: AgentCoordinator;
  trackerFactory?: () => TimeBudgetTracker;
  modelVersionValidator: ModelVersionValidator;
  logger?: Pick<Console, "debug" | "info" | "warn" | "error">;
}

export class ReplayEngine {
  constructor(private readonly deps: ReplayEngineDeps) {}

  async replayHand(record: HandRecord): Promise<ReplayResult> {
    const start = performance.now();
    const state = deserializeGameState(record.rawGameState);
    const versionCheck = await this.deps.modelVersionValidator.validate(record.metadata.modelVersions);
    const tracker = this.deps.trackerFactory ? this.deps.trackerFactory() : undefined;
    tracker?.start?.();

    const pipeline = await this.executePipeline(state, record.sessionId, tracker);

    const comparison = buildComparison(
      record.handId,
      record.sessionId,
      record.decision,
      pipeline.decision,
      versionCheck,
      record.metadata.modelVersions
    );
    const replayMs = performance.now() - start;

    return {
      handId: record.handId,
      sessionId: record.sessionId,
      success: true,
      comparison,
      originalDecision: record.decision,
      replayedDecision: pipeline.decision,
      timing: {
        replayMs,
        originalTotalMs: record.decision.timing.totalTime,
        replayedTotalMs: pipeline.decision.timing.totalTime
      }
    };
  }

  async replayBatch(
    filePath: string,
    options: ReadHandRecordsOptions = {}
  ): Promise<BatchReplayReport> {
    const comparisons: ReplayComparison[] = [];
    const errors: Array<{ handId: string; error: string }> = [];
    const divergences: number[] = [];
    const gtoTimingDeltas: number[] = [];
    const agentTimingDeltas: number[] = [];
    const totalTimingDeltas: number[] = [];
    const modelWarnings = new Set<string>();

    let totalHands = 0;
    let successful = 0;
    let matches = 0;
    let batchSessionId: string | undefined;

    for await (const record of readHandRecords(filePath, options)) {
      totalHands += 1;
      try {
        const result = await this.replayHand(record);
        successful += 1;
        batchSessionId = batchSessionId ?? record.sessionId;
        if (result.comparison) {
          comparisons.push(result.comparison);
          if (result.comparison.match) {
            matches += 1;
          }
          if (result.comparison.differences?.blendedDistribution) {
            divergences.push(result.comparison.differences.blendedDistribution.divergence);
          }
          if (result.comparison.differences?.timing) {
            const delta = result.comparison.differences.timing.delta;
            if (typeof delta.gtoTime === "number") {
              gtoTimingDeltas.push(delta.gtoTime);
            }
            if (typeof delta.agentTime === "number") {
              agentTimingDeltas.push(delta.agentTime);
            }
            if (typeof delta.totalTime === "number") {
              totalTimingDeltas.push(delta.totalTime);
            }
          }
          result.comparison.warnings.forEach(warning => modelWarnings.add(warning));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ handId: record.handId, error: message });
      }
    }

    const mismatches = comparisons.length - matches;

    return {
      sessionId: batchSessionId ?? "batch",
      totalHands,
      successful,
      failed: totalHands - successful,
      matches,
      mismatches,
      errors,
      comparisons,
      summary: {
        actionMatchRate: comparisons.length > 0 ? matches / comparisons.length : 0,
        avgDivergence: average(divergences),
        p95Divergence: percentile(divergences, 95),
        timingDelta: {
          gto: { mean: average(gtoTimingDeltas), p95: percentile(gtoTimingDeltas, 95) },
          agents: { mean: average(agentTimingDeltas), p95: percentile(agentTimingDeltas, 95) },
          total: { mean: average(totalTimingDeltas), p95: percentile(totalTimingDeltas, 95) }
        }
      },
      modelVersionWarnings: Array.from(modelWarnings)
    };
  }

  private async executePipeline(
    state: ReturnType<typeof deserializeGameState>,
    sessionId: string,
    tracker?: TimeBudgetTracker
  ): Promise<DecisionPipelineResult> {
    return runDecisionPipeline(state, sessionId, {
      strategyEngine: this.deps.strategyEngine,
      gtoSolver: this.deps.gtoSolver,
      agentCoordinator: this.deps.agentCoordinator,
      tracker,
      gtoBudgetMs: this.deps.configManager.get<number>("gto.subgameBudgetMs"),
      logger: this.deps.logger
    });
  }
}

function buildComparison(
  handId: string,
  sessionId: string,
  original: SerializedStrategyDecision,
  replayed: StrategyDecision,
  versionCheck: {
    mismatches: ModelVersionMismatch[];
    warnings: string[];
    current: ModelVersions;
  },
  loggedVersions?: ModelVersions
): ReplayComparison {
  const actionMatch = actionsEqual(original.action, replayed.action);
  const rngMatch = original.metadata.rngSeed === replayed.metadata.rngSeed;
  const originalMap = serializedEntriesToMap(original.reasoning.blendedDistribution);
  const replayedMap = replayed.reasoning.blendedDistribution;
  const divergence = computeDivergence(originalMap, replayedMap);

  const timingDelta = {
    gtoTime: replayed.timing.gtoTime - original.timing.gtoTime,
    agentTime: replayed.timing.agentTime - original.timing.agentTime,
    totalTime: replayed.timing.totalTime - original.timing.totalTime
  };

  const differences: ReplayComparison["differences"] = {};
  if (!actionMatch) {
    differences.action = { original: original.action, replayed: replayed.action };
  }
  if (!rngMatch) {
    differences.rngSeed = { original: original.metadata.rngSeed, replayed: replayed.metadata.rngSeed };
  }
  if (divergence > 0) {
    differences.blendedDistribution = {
      original: original.reasoning.blendedDistribution,
      replayed: Array.from(replayedMap.entries()).map(([actionKey, probability]) => ({
        actionKey,
        probability
      })),
      divergence
    };
  }
  if (timingDelta.gtoTime || timingDelta.agentTime || timingDelta.totalTime) {
    differences.timing = {
      original: original.timing,
      replayed: replayed.timing,
      delta: timingDelta
    };
  }
  if (versionCheck.mismatches.length > 0) {
    differences.modelVersions = {
      logged: loggedVersions,
      current: versionCheck.current,
      mismatches: versionCheck.mismatches.map(mismatch => {
        const agentPart = mismatch.agentId ? ` (${mismatch.agentId})` : "";
        return `${mismatch.component}${agentPart} ${mismatch.field}`;
      })
    };
  }

  const warnings = [...versionCheck.warnings];

  const diff = Object.keys(differences ?? {}).length ? differences : undefined;

  return {
    handId,
    sessionId,
    match: actionMatch && rngMatch && divergence === 0 && versionCheck.mismatches.length === 0,
    differences: diff,
    warnings
  };
}

function actionsEqual(a: StrategyDecision["action"], b: StrategyDecision["action"]): boolean {
  return a.type === b.type && a.position === b.position && (a.amount ?? 0) === (b.amount ?? 0);
}

function serializedEntriesToMap(entries: Array<{ actionKey: string; probability: number }>): Map<ActionKey, number> {
  const map = new Map<ActionKey, number>();
  for (const entry of entries) {
    map.set(entry.actionKey, entry.probability);
  }
  return map;
}

function computeDivergence(original: Map<string, number>, replayed: Map<string, number>): number {
  const keys = new Set([...original.keys(), ...replayed.keys()]);
  let total = 0;
  for (const key of keys) {
    total += Math.abs((original.get(key) ?? 0) - (replayed.get(key) ?? 0));
  }
  return (total / 2) * 100;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((percentileValue / 100) * sorted.length)));
  return sorted[index];
}
