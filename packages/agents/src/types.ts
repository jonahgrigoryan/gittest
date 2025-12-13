import type { GameState, ActionType } from "@poker-bot/shared";
import type { AgentProvider } from "@poker-bot/shared";
import type { BudgetComponent } from "@poker-bot/shared";

export type AgentIdentifier = string;

export interface SolverSummary {
  recommendedAction: ActionType | null;
  rationale?: string;
  equities?: Record<string, number>;
  confidence?: number;
}

export interface PromptContext {
  requestId: string;
  timeBudgetMs: number;
  solverSummary?: SolverSummary;
  handMetadata?: Record<string, unknown>;
  personaOverrides?: Record<string, PersonaRuntimeOverride>;
}

export interface PersonaRuntimeOverride {
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  styleHints?: Record<string, unknown>;
}

export interface PersonaTemplate {
  id: string;
  description: string;
  styleHints: Record<string, unknown>;
  prompt(state: GameState, context: PromptContext): string;
  maxTokens: number;
  temperature: number;
  topP?: number;
  stopSequences?: string[];
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
}

export interface TransportRequest {
  agentId: AgentIdentifier;
  personaId: string;
  prompt: string;
  systemPrompt?: string;
  maxTokens: number;
  temperature: number;
  topP?: number;
  stopSequences?: string[];
  metadata?: Record<string, unknown>;
}

export type TransportFinishReason = "stop" | "length" | "timeout" | "error";

export interface TransportResponse {
  agentId: AgentIdentifier;
  personaId: string;
  raw: string;
  latencyMs: number;
  tokenUsage: TokenUsage;
  finishReason: TransportFinishReason;
  statusCode?: number;
  providerError?: string;
}

export interface CostQuote {
  estimatedCostUsd: number;
  withinBudget: boolean;
  throttled?: boolean;
}

export interface AgentTransport {
  id: string;
  modelId: string;
  provider: AgentProvider;
  invoke(payload: TransportRequest, signal: AbortSignal): Promise<TransportResponse>;
  estimateCost(usage: TokenUsage): CostQuote;
  supportsStreaming?: boolean;
}

export interface AgentDefinition {
  id: AgentIdentifier;
  modelId: string;
  personaId: string;
  description?: string;
  enabled: boolean;
  baselineWeight?: number;
}

export interface AgentOutput {
  agentId: AgentIdentifier;
  personaId: string;
  reasoning: string;
  action: ActionType;
  sizing?: number;
  confidence: number;
  latencyMs: number;
  tokenUsage: TokenUsage;
  costUsd?: number;
  raw?: string;
  metadata?: Record<string, unknown>;
}

export type AgentFailureReason =
  | "timeout"
  | "validation"
  | "transport"
  | "cost_guard"
  | "circuit_breaker"
  | "disabled"
  | "unknown";

export interface AgentFailure {
  agentId: AgentIdentifier;
  personaId: string;
  reason: AgentFailureReason;
  latencyMs: number;
  raw?: string;
  details?: string;
}

export interface AggregatedCostSummary {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCostUsd?: number;
}

export interface AggregatedAgentOutput {
  outputs: AgentOutput[];
  normalizedActions: Map<ActionType, number>;
  consensus: number;
  winningAction: ActionType | null;
  budgetUsedMs: number;
  circuitBreakerTripped: boolean;
  notes?: string;
  droppedAgents?: AgentFailure[];
  costSummary?: AggregatedCostSummary;
  startedAt: number;
  completedAt: number;
}

export interface ValidationError {
  message: string;
  path?: string;
  keyword?: string;
  schemaErrors?: string[];
}

export type ValidationResult =
  | { ok: true; data: AgentOutput }
  | { ok: false; error: ValidationError; raw: string; latencyMs: number };

export interface BrierSample {
  agentId: AgentIdentifier;
  personaId?: string;
  predicted: number;
  outcome: number;
  weight: number;
  timestamp: number;
}

export interface WeightSnapshotEntry {
  agentId: AgentIdentifier;
  personaId: string;
  weight: number;
  brierScore: number;
  sampleCount: number;
  updatedAt: number;
}

export interface WeightSnapshot {
  version: number;
  updatedAt: number;
  decayFactor: number;
  defaultWeight: number;
  entries: Record<string, WeightSnapshotEntry>;
}

export interface CostBudgetPolicy {
  maxTokensDecision: number;
  maxTokensDay: number;
  maxLatencyMs: number;
  consecutiveFailureThreshold: number;
  recoveryHands: number;
}

export interface CircuitBreakerConfig {
  consecutiveFailureThreshold: number;
  cooldownHands: number;
  minCooldownMs?: number;
}

export interface CircuitBreakerState {
  consecutiveFailures: number;
  trippedAt?: number;
  cooldownHandsRemaining?: number;
  lastFailureReason?: AgentFailureReason;
}

export interface AgentCoordinatorTelemetry {
  personaId: string;
  provider: AgentProvider;
  latencyMs: number;
  confidence: number;
  weight: number;
  outputTokens: number;
  promptTokens: number;
  validationError?: string;
  circuitBreakerState?: CircuitBreakerState;
}

export interface AgentQueryOptions {
  signal?: AbortSignal;
  budgetOverrideMs?: number;
  forcePersonas?: string[];
  disableCostGuard?: boolean;
}

export interface AgentCoordinator {
  query(state: GameState, context: PromptContext, options?: AgentQueryOptions): Promise<AggregatedAgentOutput>;
  preload?(): Promise<void>;
  shutdown?(): Promise<void>;
}

export interface WeightUpdateRequest {
  samples: BrierSample[];
  snapshot: WeightSnapshot;
}

export interface TimeBudgetTracker {
  reserve(component: BudgetComponent, durationMs: number): boolean;
  release?(component: BudgetComponent, durationMs: number): void;
  start?(): void;
  startComponent?(component: BudgetComponent): void;
  endComponent?(component: BudgetComponent): number;
  recordActual?(component: BudgetComponent, durationMs: number): void;
  shouldPreempt?(component: BudgetComponent): boolean;
  remaining?(component?: BudgetComponent): number;
  elapsed?(): number;
}
