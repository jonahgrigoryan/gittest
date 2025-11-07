<<<<<<< Current (Your changes)
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
=======
# Repository Guidelines

## Project Structure & Module Organization
- `packages/agents`, `executor`, `logger`, `orchestrator`, `shared`: TypeScript workspaces; shared provides config schemas and generated protobuf bindings in `src/gen`.
- `services/solver`: Rust gRPC solver crate; build output stays in `services/solver/target`.
- `proto/`, `tools/`, `config/`, `infra/`, `native/`: protobuf sources, automation scripts, environment configs, infra helpers, and native bridges.
- `tests/`, `coverage/`, `logs/`, `results/`: integration scaffolding and CI artifacts; keep generated files out of Git unless explicitly tracked.

## Build, Test, and Development Commands
- `pnpm install`: install workspace deps (pnpm 9 per `.nvmrc`).
- `pnpm run verify:env`: confirm Node, pnpm, Python, `protoc`, and `buf` are on PATH.
- `pnpm run proto:gen`: regenerate TypeScript stubs after editing `proto/`; commits should include updated files in `packages/shared/src/gen`.
- `pnpm run build` | `pnpm run lint`: compile and lint every package; both must pass before opening a PR.
- `pnpm run test:unit`: run Vitest suites in each package; add `--watch` locally.
- `cargo test --manifest-path services/solver/Cargo.toml`: validate the Rust solver alongside JS tests.

## Coding Style & Naming Conventions
- Follow `.editorconfig`: two-space indentation, UTF-8, LF endings, final newline.
- Use `camelCase` for symbols, `PascalCase` for exports, `SCREAMING_SNAKE_CASE` for constants; prefer kebab-case filenames.
- Keep modules focused; re-export only from `packages/*/src/index.ts`; run `pnpm run lint -- --fix` or Prettier integration to resolve style issues.

## Testing Guidelines
- Place TypeScript specs beside the package under `test/` using `*.spec.ts` or `*.test.ts` mirrored to `src/`.
- Populate root-level `tests/` with multi-service or scenario flows and ensure `pnpm run test` reports the new cases.
- Use Vitest mocks for network boundaries and `tokio::test` for Rust async paths; document new flags or fixtures in `setup.md`.

## Commit & Pull Request Guidelines
- Prefer imperative, present-tense commit subjects under ~72 chars; conventional prefixes (`chore(ci): ...`) are welcome but optional.
- Keep generated outputs with their sources (e.g., commit `proto/` and `src/gen` together) and note behavioral changes in the commit body.
- PRs should list affected packages, link relevant design notes, and include the commands you ran (`pnpm run build`, `pnpm run lint`, `pnpm run test:unit`, Cargo tests).

## Proto & Native Tooling
- Update `.proto` definitions in lockstep with consumers, then run `pnpm run proto:gen` and `cargo build` before pushing.
- Coordinate Buf or Rust toolchain bumps via `setup.md` and notify infra owners when requirements change.

## Agent Coordinator Overview
- `packages/agents/src/coordinator.ts` orchestrates persona prompts, transport execution, schema validation, weighting, and aggregation.
- Personas live in `packages/agents/src/personas` with prompts constructed via `promptBuilder.ts`; overrides come from `agents.personaOverrides` config.
- Transport adapters reside under `packages/agents/src/transports` (OpenAI-compatible, mock) and run concurrently via `coordinator/concurrency.ts` with per-agent aborts.
- JSON output schema enforcement is handled by `schema/validator.ts` (strict AJV) and failures are reported through `AgentFailure` telemetry records.
- Weighting, Brier updates, and persistence flow through `weighting/engine.ts` and `weighting/storage.ts`, with defaults stored at `agents.weightStorePath`.
- Cost guard and circuit breaker enforcement is defined in `policy/costGuard.ts` and `policy/circuitBreaker.ts`; thresholds read from `agents.costPolicy` and `agents.circuitBreaker`.
- Structured telemetry is emitted from `telemetry/logger.ts` with reasoning redaction respecting `LOG_VERBOSE_AGENTS`.
>>>>>>> Incoming (Background Agent changes)
