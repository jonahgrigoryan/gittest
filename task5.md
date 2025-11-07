# Task 5: Agent Coordinator — Detailed Implementation Plan

## Current State Assessment

- `packages/agents/src/coordinator.ts` is a stub (`export const DUMMY = true;`), so agent orchestration is absent.
- `packages/agents/src/index.ts` exports only a placeholder flag and `packages/agents/test/agent_schema.spec.ts` asserts that flag; there are no real tests for schema validation, weighting, or concurrency.
- `packages/shared/src/config/types.ts` provides basic agent config but lacks persona overrides, weight persistence, cost guard, circuit breaker, or calibration fields; corresponding `config/schema/bot-config.schema.json` and sample configs do not include upcoming extensions.
- Agent subdirectories (`personas`, `schema`, `transports`) are empty and `proto/agents.proto` is a placeholder; orchestrator wiring in `packages/orchestrator/src/main.ts` lacks agents and SafeAction widening hooks, though Task 4 already delivers solver integration via `packages/orchestrator/src/solver_client/client.ts`.
- Requirements 5.1–5.6 (prompts, parallel querying, schema enforcement, weighting, cost guard, validator tests) remain unaddressed.

## Architecture & Interfaces

- Flow: Orchestrator obtains `GameState` and `GTOSolution` via `packages/orchestrator/src/solver_client/client.ts` (Task 4) → AgentCoordinator derives a lightweight `SolverSummary` (top `ActionKey` + frequencies, EV snapshot) for `PromptContext` and receives remaining budget from `TimeBudgetTracker`; if remaining budget is 0 ms it skips agents → persona registry builds prompts grounded on `GameState`, `SolverSummary`, SafeAction guidance → transport layer invokes LLMs concurrently with per-agent timeout `min(persona.timeoutMs, remainingBudget / activeAgents, 3000)` and uses `AbortController` to preempt when solver overruns → responses validated against strict JSON schema → weighting engine applies Brier-calibrated weights using history → aggregation normalizes probabilities by `ActionKey` (via `createActionKey(action)`) and computes sizing guidance (weighted median pot fraction for winning `ActionKey`) with no blending (Strategy Engine handles blending in Task 8) → coordinator emits `AggregatedAgentOutput` plus telemetry/failure summary so orchestrator widens SafeAction probability or falls back to `α=1.0` GTO when all agents fail or circuit breaker is open.
- Interfaces (`packages/agents/src/types.ts`, re-exported via `index.ts`):
```typescript
import type { Action, ActionKey, GameState } from "@poker-bot/shared";

export interface SolverSummary { topActions: Array<{ key: ActionKey; probability: number; ev: number }>; source: string; }
export interface PromptContext { solver?: SolverSummary; safeAction: Action; }
export interface PersonaTemplate {
  id: string;
  description: string;
  timeoutMs: number;
  styleHints: Record<string, unknown>;
  buildPrompt(state: GameState, context: PromptContext): string;
  maxTokens: number;
  temperature: number;
}
export interface AgentTransport {
  id: string;
  provider: AgentProvider;
  modelId: string;
  invoke(request: TransportRequest, signal: AbortSignal): Promise<TransportResponse>;
  estimateCost(tokens: TokenUsage): CostQuote;
}
export interface AgentOutput {
  agentId: string;
  personaId: string;
  reasoning: string;
  action: Action;
  confidence: number;
  sizingPotFraction?: number;
  latencyMs: number;
  tokenUsage: TokenUsage;
}
export interface AggregatedAgentOutput {
  outputs: AgentOutput[];
  normalizedActions: Map<ActionKey, number>;
  sizingGuidance?: { actionKey: ActionKey; weightedMedianPotFraction?: number; supportingAgents: string[] };
  consensus: number;
  winningActionKey: ActionKey | null;
  budgetUsedMs: number;
  circuitBreakerTripped: boolean;
  failureSummary: FailureSnapshot;
}
```

- JSON schema (default stored in `packages/agents/src/schema/default-schema.json`, referenced by config) enforces: `confidence` in [0,1]; `reasoning` non-empty string; `recommendation.action` matches shared `Action` structure (type/position/street, optional amount ≥0); if `sizing` provided, ensure 0 ≤ sizing ≤ 5; ensure optional `tokenUsage` fields numeric.
- Weighting: Brier updates sourced from (a) offline labeled validation set via CLI import (`pnpm --filter "@poker-bot/agents" run calibrate --path ...`), and (b) post-hand adjudication events emitted by logging after each hand. Updates run asynchronously after each hand so query latency is unaffected.
- Timeout/preemption: per-agent timeout uses formula above; exponential backoff retries (≤3) respect remaining budget via AbortController cancellation; if solver overruns leaving no budget, agents are canceled immediately.
- Fallback: when all agents fail validation/timeout or circuit breaker is open, coordinator emits `failureSummary` flag prompting orchestrator to run pure GTO (`α=1.0`) per AGENTS.md.
- Telemetry: Coordinator emits structured agent events (persona, latency, confidence, weight, validation errors, circuit breaker state) alongside existing solver telemetry; raw reasoning only logged if `LOG_VERBOSE_AGENTS=1`.

## Step-by-step Plan

### Step 1 — Shared types & config alignment

- Objective: Define agent types using shared `Action`/`ActionKey`, expose coordinator interfaces, and align config schema/defaults.
- Files: `packages/agents/src/types.ts`, update `packages/agents/src/index.ts`, extend `packages/shared/src/config/types.ts`, `config/schema/bot-config.schema.json`, `config/bot/default.bot.json` (add `agents.weightStorePath`, `agents.costPolicy`, `agents.circuitBreaker`, `agents.calibration`, persona overrides), update `packages/shared/src/config/manager.ts` loaders.
- Tests: Add `packages/shared/test/config/agents-config.spec.ts` to ensure schema & defaults validate.
- Verification: `pnpm --filter "@poker-bot/shared" run test`, `pnpm --filter "@poker-bot/agents" run lint`.

### Step 2 — Persona templates & prompt builder

- Objective: Implement persona registry and prompt construction with SafeAction & SolverSummary context, keeping prompts <1k tokens.
- Files: `packages/agents/src/personas/{index.ts,gtoPurist.ts,exploitAggressor.ts,riskAverseValue.ts}`, `packages/agents/src/personas/promptBuilder.ts`, update config schema/default for persona overrides and samples.
- Key functions: `buildPrompt(state, context)` incorporating SolverSummary, SafeAction, legal actions, config overrides; register defaults with metadata (timeout, temperature).
- Tests: `packages/agents/test/personas.spec.ts` verifying prompt content, size, persona metadata, config validation.
- Verification: `pnpm --filter "@poker-bot/agents" run test`.

### Step 3 — Transport adapters & concurrency scaffolding

- Objective: Build transport base, OpenAI adapter, mock transport, and concurrency helper using timeout formula.
- Files: `packages/agents/src/transports/{base.ts,openai.ts,mock.ts}`, `packages/agents/src/coordinator/concurrency.ts`, document provider expectations in `AGENTS.md`.
- Key functions: `invoke` with exponential backoff; concurrency helper computing per-agent timeout `min(persona.timeoutMs, remainingBudget / activeAgents, 3000)` and handling AbortController preemption when remaining budget hits 0.
- Tests: `packages/agents/test/transports.spec.ts`, `packages/agents/test/concurrency.spec.ts` covering retry/backoff, timeout division, solver overrun preemption.
- Verification: `pnpm --filter "@poker-bot/agents" run test`.

### Step 4 — JSON schema validation & coordinator orchestration

- Objective: Implement AJV validator enforcing shared `Action` shape and integrate into AgentCoordinator; surface failure summary to orchestrator.
- Files: `packages/agents/src/schema/{index.ts,validator.ts,default-schema.json}`, update `packages/agents/src/coordinator.ts`, add `packages/agents/src/errors.ts`, extend `packages/shared/src/config/index.ts` for schema loading.
- Functions: `validateAgentResponse(raw, latency)` returning typed result; coordinator orchestrates concurrency, collects failure summary (timeouts, invalid counts), and emits aggregator output.
- Tests: `packages/agents/test/validator.spec.ts`, `packages/agents/test/coordinator.validation.spec.ts` verifying schema bounds, failure summary emission.
- Verification: `pnpm --filter "@poker-bot/agents" run lint && pnpm --filter "@poker-bot/agents" run test`.

### Step 5 — Weighting engine, aggregation, calibration hooks

- Objective: Implement Brier scoring, weight persistence, sizing aggregation, and calibration import/update pipeline.
- Files: `packages/agents/src/weighting/{engine.ts,brier.ts,storage.ts,calibration.ts}`, `packages/agents/src/coordinator/aggregation.ts`, config schema/defaults for calibration path & options.
- Functions: `computeWeightedDistribution(outputs, weights)` returning `Map<ActionKey, number>`; `aggregateSizingForActionKey(outputs, actionKey)` computing weighted median pot fraction; `recordOutcome` applying Brier updates asynchronously after each hand; CLI command to seed weights from labeled data.
- Tests: `packages/agents/test/weighting.spec.ts`, `packages/agents/test/calibration.spec.ts` verifying Brier math, uniform fallback, sizing aggregation, CLI import.
- Verification: `pnpm --filter "@poker-bot/agents" run test`.

### Step 6 — Cost guard, circuit breaker, telemetry & orchestrator notifications

- Objective: Enforce cost/time caps, circuit breaker, agent telemetry, and orchestrator SafeAction fallback hook.
- Files: `packages/agents/src/policy/{costGuard.ts,circuitBreaker.ts}`, `packages/agents/src/telemetry/logger.ts`, augment `packages/agents/src/coordinator.ts`, update orchestrator wiring (`packages/orchestrator/src/main.ts`, `packages/orchestrator/src/index.ts`), extend config schema/defaults, update `AGENTS.md` with telemetry fields and fallback guidance.
- Functions: `CostGuard.evaluateDecision` enforcing budgets; `CircuitBreaker.update` toggling breaker; `emitAgentEvent` publishing telemetry; orchestrator handles `failureSummary` and `circuitBreakerTripped` to widen SafeAction probability or use α=1.0.
- Tests: `packages/agents/test/policy.spec.ts`, `packages/agents/test/telemetry.spec.ts`, `packages/orchestrator/test/agents-notify.spec.ts` verifying fallback behavior.
- Verification: `pnpm --filter "@poker-bot/agents" run lint && pnpm --filter "@poker-bot/agents" run test`; `pnpm --filter "@poker-bot/orchestrator" run test`.

### Step 7 — Integration glue & documentation

- Objective: Finalize coordinator factory, integration tests, docs, and builds.
- Files: `packages/agents/src/index.ts` (export `createAgentCoordinator`), orchestrator integration tests, `AGENTS.md` updates (timeouts, fallback, telemetry), `task5.md` summary, sample config adjustments, proto comment clarifying no solver changes.
- Tests: `packages/agents/test/coordinator.integration.spec.ts` (end-to-end with mocks), `packages/orchestrator/test/agents.integration.spec.ts` verifying GTOSolution → SolverSummary pipeline and pure GTO fallback; ensure `pnpm --filter "@poker-bot/agents" run build` and orchestrator build succeed; repository smoke (`pnpm lint && pnpm test`).

## Test Plan

- Unit: schema bounds (confidence, Action shape, sizing), persona prompt budgets, transport retry/backoff with AbortSignal, weighting math & sizing aggregation, cost guard & breaker thresholds, telemetry redaction, config schema validation.
- Integration: coordinator concurrency under zero budget, calibration import seeding weights, orchestrator SafeAction widening and α=1.0 fallback, async Brier updates after simulated hand outcomes, telemetry emission alignment.
- Fixtures: `packages/agents/test/fixtures/state-basic.json`, legal action samples, valid/invalid agent responses, `data/agents/sample-calibration.json` for CLI tests, temp dirs for weight store.

## Telemetry & Config

- Config keys documented in schema/default configs (`agents.weightStorePath`, `agents.costPolicy`, `agents.circuitBreaker`, `agents.calibration`, persona overrides, provider settings); default values defined in `packages/shared/src/config/manager.ts`.
- Telemetry events include { personaId, provider, latencyMs, promptTokens, completionTokens, confidence, weight, actionKey, validationError?, timeoutMs, breakerState }; reasoning redacted unless `LOG_VERBOSE_AGENTS=1`.
- PromptContext receives SolverSummary derived from GTOSolution without modifying solver types or proto; telemetry is emitted alongside existing solver metrics.

## Risks & Mitigations

- Latency overruns: enforce timeout formula, AbortController preemption, log durations; tune persona maxTokens via config.
- Schema drift: version default schema, validate on startup, fallback to GTO-only if schema compile fails.
- Calibration data stale: provide CLI import, verify checksum before applying; fallback to uniform weights on failure.
- Provider instability/cost spikes: cost guard degrade path, circuit breaker for repeated failures, offline mock transport for testing.
- Persistence corruption: atomic writes for weight store and recovery to uniform weights with telemetry alert.

## Milestones & PR Breakdown

- PR1: Shared types & config schema alignment (Step 1) with verification commands.
- PR2: Personas & prompt builder (Step 2).
- PR3: Transports & concurrency (Step 3).
- PR4: Schema validation & coordinator orchestration with failure summaries (Step 4).
- PR5: Weighting, aggregation, calibration hooks (Step 5).
- PR6: Cost guard, circuit breaker, telemetry, orchestrator notifications (Step 6).
- PR7: Integration tests, documentation, builds (Step 7).

## Acceptance Checklist

- [ ] 5.1 Persona templates & prompts implemented, schema/config aligned.
- [ ] 5.2 Parallel querying with timeout formula, AbortController preemption, SafeAction widening notifications.
- [ ] 5.3 Strict JSON schema validation enforcing shared `Action` shape, confidence bounds, sizing limits.
- [ ] 5.4 Weighting/aggregation produce `ActionKey` probabilities, weighted sizing, and support calibration imports with async Brier updates.
- [ ] 5.5 Cost controls & circuit breaker enforce budgets, emit telemetry, and trigger α=1.0 fallback when required.
- [ ] 5.6 Tests cover schema validation, timeout handling, weighting math, circuit breaker, config schema; verification commands documented and passing.
