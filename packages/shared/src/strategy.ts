import { createHash } from "node:crypto";
import type {
  Action,
  ActionKey,
  ActionType,
  Card,
  GameState,
  GTOSolution,
  Position
} from "./types";

export interface StrategyConfig {
  alphaGTO: number;  // [0.3, 0.9] - GTO weight in blend
  betSizingSets: {
    preflop: number[];
    flop: number[];
    turn: number[];
    river: number[];
  };
  divergenceThresholdPP: number;  // Log when GTO vs agents differ >30pp
  rngSeed?: number;  // For deterministic replay
  opponentModeling?: {
    enabled: boolean;
    minHands: number;
  };
}

export interface BlendedDistribution {
  actions: Map<ActionKey, number>;
  alpha: number;
  gtoWeight: number;
  agentWeight: number;
}

export interface StrategyReasoningTrace {
  gtoRecommendation: Map<ActionKey, number>;
  agentRecommendation: Map<ActionKey, number>;
  blendedDistribution: Map<ActionKey, number>;
  alpha: number;
  divergence: number;
  riskCheckPassed: boolean;
  sizingQuantized: boolean;
  fallbackReason?: string;
  panicStop?: boolean;
}

export interface StrategyTimingBreakdown {
  gtoTime: number;
  agentTime: number;
  synthesisTime: number;
  totalTime: number;
}

export interface StrategyMetadata {
  rngSeed: number;
  configSnapshot: StrategyConfig;
  riskSnapshot?: any;  // From risk controller
  modelHashes?: Record<string, string>;
  preempted?: boolean;
  usedGtoOnlyFallback?: boolean;
  panicStop?: boolean;
}

export interface StrategyDecision {
  action: Action;
  reasoning: StrategyReasoningTrace;
  timing: StrategyTimingBreakdown;
  metadata: StrategyMetadata;
}

export interface SerializedGameState {
  handId: string;
  gameType: GameState["gameType"];
  blinds: GameState["blinds"];
  positions: GameState["positions"];
  players: Array<{ position: Position; stack: number; holeCards?: Card[] }>;
  communityCards: GameState["communityCards"];
  pot: number;
  street: GameState["street"];
  actionHistory: GameState["actionHistory"];
  legalActions: GameState["legalActions"];
  confidence: {
    overall: number;
    perElement: Record<string, number>;
  };
  latency: number;
}

export interface SerializedProbabilityEntry {
  actionKey: ActionKey;
  probability: number;
}

export interface SerializedStrategyDecision {
  action: Action;
  reasoning: {
    gtoRecommendation: SerializedProbabilityEntry[];
    agentRecommendation: SerializedProbabilityEntry[];
    blendedDistribution: SerializedProbabilityEntry[];
    alpha: number;
    divergence: number;
    riskCheckPassed: boolean;
    sizingQuantized: boolean;
    fallbackReason?: string;
    panicStop?: boolean;
  };
  timing: StrategyTimingBreakdown;
  metadata: {
    rngSeed: number;
    configHash: string;
    riskSnapshotId?: string;
    modelHashes?: Record<string, string>;
    preempted?: boolean;
    usedGtoOnlyFallback?: boolean;
    panicStop?: boolean;
  };
}

export interface AggregatedAgentOutputLike {
  outputs: Array<{
    agentId: string;
    personaId: string;
    reasoning: string;
    action: ActionType;
    sizing?: number;
    confidence: number;
    latencyMs: number;
    tokenUsage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens?: number;
    };
    costUsd?: number;
  }>;
  normalizedActions: Map<ActionType, number>;
  consensus: number;
  winningAction: ActionType | null;
  budgetUsedMs: number;
  circuitBreakerTripped: boolean;
  notes?: string;
  droppedAgents?: Array<{ agentId: string; reason: string }>;
  costSummary?: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    totalCostUsd?: number;
  };
  startedAt: number;
  completedAt: number;
}

export interface SerializedAgentOutput {
  outputs: Array<{
    agentId: string;
    personaId: string;
    reasoning: string;
    action: ActionType;
    sizing?: number;
    confidence: number;
    latencyMs: number;
    tokenUsage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens?: number;
    };
    costUsd?: number;
  }>;
  normalizedActions: Record<ActionType, number>;
  consensus: number;
  winningAction: ActionType | null;
  budgetUsedMs: number;
  circuitBreakerTripped: boolean;
  notes?: string;
  droppedAgents?: Array<{ agentId: string; reason: string }>;
  costSummary?: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    totalCostUsd?: number;
  };
  startedAt: number;
  completedAt: number;
}

export interface ExecutionResultLike {
  success: boolean;
  actionExecuted?: Action;
  error?: string;
  verificationResult?: {
    passed: boolean;
    mismatchReason?: string;
    retryCount: number;
  };
  timing?: {
    executionMs: number;
    verificationMs?: number;
    totalMs: number;
  };
  metadata?: {
    executionMode: string;
    platform?: string;
    windowHandle?: string;
  };
}

export interface SerializedExecutionResult {
  success: boolean;
  actionExecuted?: Action;
  error?: string;
  verification?: {
    passed: boolean;
    mismatchReason?: string;
  };
  timing?: {
    executionMs: number;
    verificationMs?: number;
    totalMs: number;
  };
  metadata?: {
    executionMode: string;
    platform?: string;
  };
}

export interface HandOutcome {
  handId: string;
  netChips: number;
  rake?: number;
  showdown?: boolean;
  recordedAt: number;
}

export interface HandRecord {
  handId: string;
  sessionId: string;
  createdAt: number;
  rawGameState: SerializedGameState;
  decision: SerializedStrategyDecision;
  execution?: SerializedExecutionResult;
  solver?: {
    actions: Array<{ actionKey: ActionKey; frequency: number; ev?: number }>;
    exploitability: number;
    computeTime: number;
    source: GTOSolution["source"];
  };
  agents?: SerializedAgentOutput;
  timing: StrategyTimingBreakdown;
  outcome?: HandOutcome;
  metadata: {
    configHash: string;
    redactionApplied: boolean;
    redactedFields?: string[];
  };
}

export interface SessionMetrics {
  sessionId: string;
  handsLogged: number;
  winRateBb100: number;
  evAccuracy: {
    meanDelta: number;
    p50Delta: number;
    p95Delta: number;
    p99Delta: number;
  };
  latency: {
    gto: { p50: number; p95: number; p99: number };
    agents: { p50: number; p95: number; p99: number };
    execution: { p50: number; p95: number; p99: number };
    total: { p50: number; p95: number; p99: number };
  };
  decisionQuality: {
    divergenceMean: number;
    riskFallbackCount: number;
    gtoOnlyFallbackCount: number;
  };
  computedAt: number;
}

export function serializeGameState(state: GameState): SerializedGameState {
  return {
    handId: state.handId,
    gameType: state.gameType,
    blinds: state.blinds,
    positions: state.positions,
    players: Array.from(state.players.entries()).map(([position, info]) => ({
      position,
      stack: info.stack,
      holeCards: info.holeCards
    })),
    communityCards: state.communityCards,
    pot: state.pot,
    street: state.street,
    actionHistory: state.actionHistory,
    legalActions: state.legalActions,
    confidence: {
      overall: state.confidence.overall,
      perElement: Object.fromEntries(state.confidence.perElement)
    },
    latency: state.latency
  };
}

export function serializeStrategyDecision(
  decision: StrategyDecision,
  configHash: string
): SerializedStrategyDecision {
  return {
    action: decision.action,
    reasoning: {
      gtoRecommendation: mapToProbabilityArray(decision.reasoning.gtoRecommendation),
      agentRecommendation: mapToProbabilityArray(decision.reasoning.agentRecommendation),
      blendedDistribution: mapToProbabilityArray(decision.reasoning.blendedDistribution),
      alpha: decision.reasoning.alpha,
      divergence: decision.reasoning.divergence,
      riskCheckPassed: decision.reasoning.riskCheckPassed,
      sizingQuantized: decision.reasoning.sizingQuantized,
      fallbackReason: decision.reasoning.fallbackReason,
      panicStop: decision.reasoning.panicStop
    },
    timing: decision.timing,
    metadata: {
      rngSeed: decision.metadata.rngSeed,
      configHash,
      riskSnapshotId: decision.metadata.riskSnapshot ? "current" : undefined,
      modelHashes: decision.metadata.modelHashes,
      preempted: decision.metadata.preempted,
      usedGtoOnlyFallback: decision.metadata.usedGtoOnlyFallback,
      panicStop: decision.metadata.panicStop
    }
  };
}

export function serializeAgentOutput(
  agents: AggregatedAgentOutputLike
): SerializedAgentOutput {
  return {
    outputs: agents.outputs.map(output => ({
      agentId: output.agentId,
      personaId: output.personaId,
      reasoning: output.reasoning,
      action: output.action,
      sizing: output.sizing,
      confidence: output.confidence,
      latencyMs: output.latencyMs,
      tokenUsage: output.tokenUsage
        ? {
            promptTokens: output.tokenUsage.promptTokens,
            completionTokens: output.tokenUsage.completionTokens,
            totalTokens:
              output.tokenUsage.totalTokens ??
              output.tokenUsage.promptTokens + output.tokenUsage.completionTokens
          }
        : undefined,
      costUsd: output.costUsd
    })),
    normalizedActions: Object.fromEntries(agents.normalizedActions) as Record<ActionType, number>,
    consensus: agents.consensus,
    winningAction: agents.winningAction,
    budgetUsedMs: agents.budgetUsedMs,
    circuitBreakerTripped: agents.circuitBreakerTripped,
    notes: agents.notes,
    droppedAgents: agents.droppedAgents,
    costSummary: agents.costSummary,
    startedAt: agents.startedAt,
    completedAt: agents.completedAt
  };
}

export function serializeExecutionResult(
  execution?: ExecutionResultLike
): SerializedExecutionResult | undefined {
  if (!execution) {
    return undefined;
  }
  return {
    success: execution.success,
    actionExecuted: execution.actionExecuted,
    error: execution.error,
    verification: execution.verificationResult
      ? {
          passed: execution.verificationResult.passed,
          mismatchReason: execution.verificationResult.mismatchReason
        }
      : undefined,
    timing: execution.timing,
    metadata: execution.metadata
      ? {
          executionMode: execution.metadata.executionMode,
          platform: execution.metadata.platform
        }
      : undefined
  };
}

export function summarizeGTOSolution(
  gto?: GTOSolution,
  limit = 10
): HandRecord["solver"] | undefined {
  if (!gto) {
    return undefined;
  }
  const actions = Array.from(gto.actions.entries())
    .map(([actionKey, entry]) => ({
      actionKey,
      frequency: entry.solution.frequency,
      ev: entry.solution.ev
    }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, limit);
  return {
    actions,
    exploitability: gto.exploitability,
    computeTime: gto.computeTime,
    source: gto.source
  };
}

export function computeConfigHash(config: StrategyConfig): string {
  const canonical = JSON.stringify(config, Object.keys(config).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

function mapToProbabilityArray(
  map: Map<ActionKey, number>
): SerializedProbabilityEntry[] {
  return Array.from(map.entries()).map(([actionKey, probability]) => ({
    actionKey,
    probability
  }));
}
