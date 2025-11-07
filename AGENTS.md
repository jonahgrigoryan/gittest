# Agents Package

The `@poker-bot/agents` workspace orchestrates the multi-LLM reasoning layer that
partners with the solver to recommend poker actions. It is responsible for
launching persona-specific prompts, validating the responses, and aggregating
them into a calibrated strategy that the orchestrator can blend with GTO output.

## Responsibilities
- Run multiple LLM personas in parallel within the shared time budget (3 s per
  agent, ~1.2 s total allocation).
- Enforce the JSON schema for responses and discard malformed or late outputs.
- Track historical accuracy (Brier score) and use the weights during action
  aggregation.
- Surface reasoning traces, timings, and weighting metadata to the strategy
  engine and logging pipeline.

## Module Layout
- `src/coordinator.ts`: Entry point used by the orchestrator; fans queries out,
  collects results, and produces an `AggregatedAgentOutput`.
- `src/personas/`: Persona definitions (prompt templates, temperature/model
  hints, guardrails).
- `src/schema/`: JSON schema + TypeScript helpers that validate agent replies.
- `src/transports/`: Client implementations for specific LLM providers
  (OpenAI-compatible REST, gRPC bridges, offline mocks).
- `test/agent_schema.spec.ts`: Contract tests that cover schema validation,
  timeout handling, and weighting edge cases.

## Query Flow
1. Orchestrator packages a `GameState` payload from `@poker-bot/shared`.
2. Coordinator clones the prompt for each persona and hands it to the matching
   transport.
3. Responses are validated against the JSON schema (`reasoning`, `action`,
   optional `sizing`, `confidence in [0,1]`).
4. Each successful response is stamped with latency and evaluated by the
   weighting engine; failures count toward timeout metrics.
5. The coordinator normalizes weighted probabilities per action and computes a
   consensus score for downstream synthesis.

## Personas & Prompting
- Default personas: **GTO Purist**, **Exploitative Aggressor**, **Risk-Averse
  Value**; configurable via `config/bot/*.bot.json`.
- Prompts contain: normalized hand history slice, board texture, stack/pot
  context, legal actions, and SafeAction guidance.
- Persona metadata may adjust temperature, max tokens, or reasoning style; keep
  prompts under 1k tokens to honor the latency budget.

## Weighting & Calibration
- Brier scoring is persisted per persona after each labeled hand.
- Weight updates run asynchronously; new weights apply on the next query.
- Fallback remains uniform weights when no calibration data is available.
- Consensus logging records the winning action confidence delta vs. GTO output.

## Error Handling & Timeouts
- Late or invalid responses are omitted; the orchestrator is notified so it can
  widen SafeAction probability.
- Total agent budget is capped by the `TimeBudgetTracker`; the coordinator
  aborts pending requests if the solver over-runs.
- If every agent fails, the orchestrator defaults to pure GTO (alpha = 1.0) per
  requirements.

## Telemetry & Logging
- Emit structured events with fields: persona, latency, confidence, weight,
  output length, validation errors.
- Sensitive payloads (raw reasoning) are redacted unless `LOG_VERBOSE_AGENTS`
  is enabled.
- Downstream consumers (logger package, results/ artifacts) rely on these
  events for per-hand auditing.

## Development Notes
- Use `pnpm --filter "@poker-bot/agents" run lint|test|build` during iteration.
- Update schemas and persona defaults alongside `packages/shared` types.
- When prompt or schema changes affect the solver interface, regenerate shared
  proto stubs with `pnpm run proto:gen` and re-run `pnpm run build`.
- Treat every task as production work: no scaffolding, no placeholder code, and no partial implementations. Coding agents must follow the task requirements end-to-end so downstream collaborators can build on the result immediately.
