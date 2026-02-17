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

## Active Workflow (Current Phase: CoinPoker macOS Autonomy)

This section is the operational workflow for ongoing "hands + eyes" work. Use it
as the default runbook for all coding agents until replaced.

## Active State Snapshot

- Brain/core stack is complete and treated as stable baseline (solver, agents, strategy,
  replay, evaluator, deployment, and associated observability/error handling).
- Current project scope is CoinPoker macOS autonomy hands+eyes.
- `.kiro/specs/coinpoker-macos-autonomy/tasks.md` checkboxes indicate:
  - Tasks 0–3 are complete on `main`.
  - Task 4 work is complete on branch `feat/task-4-nutjs-input-automation` and awaiting merge.
    - Task 0 fast-check prerequisite
    - Task 1 research UI config schema and validation
    - Task 2 WindowManager AppleScript implementation
    - Task 3 compliance process detection
    - Task 4 nut.js input automation + bet input integration
- Current next target is to finish Task 4 PR/merge, then Task 5 (executor infrastructure checkpoint).
- Confirmed post-Phase-12 successful commits on main/task branch are:
  - `228bea7` (`Phase 12: Decision Pipeline E2E + Final Integration Gate`)
  - `878b5d3` (`Phase 11: Observability + Health Controller Coverage`)
  - `15f60cb` (`Phase 10: Executor Error Paths & Verification`)
  - `be5e487` (`Phase 9: Time Budget & Preemption Hardening`)
  - `be4babf` (`Phase 8: Vision & solver client integration tests`)
  - `f176c2f` (`feat(executor): complete task 1 research-ui config schema and validation`)
  - `930e47` (`chore(test): add fast-check prerequisite for autonomy tasks`)
  - `7015f6e` (`feat(executor): harden window discovery, focus safety, and config schema`)
  - `474f3d4` (`feat(executor): implement task 3 compliance process detection`)
  - `9044613` (`feat(executor): implement task 4 input automation and scaling`)
  - `616cfac` (`fix(executor): lazy-load nutjs bindings at runtime`)

### Scope & Source of Truth
- Brain/core decision stack is complete (solver + agents + strategy + replay).
- Active development scope is CoinPoker macOS autonomy:
  - "Hands": executor/macOS automation integration.
  - "Eyes": vision/layout/runtime integration for live operation.
- Source docs in priority order:
  1. `.kiro/specs/coinpoker-macos-autonomy/requirements.md`
  2. `.kiro/specs/coinpoker-macos-autonomy/design.md`
  3. `.kiro/specs/coinpoker-macos-autonomy/tasks.md`
  4. `docs/plans/2026-02-03-coinpoker-autonomy.md` (implementation aid)

### Branching & PR Policy (Mandatory)
- Start each task from `main`.
- Branch name must start with `feat/` so push-trigger CI runs on branch updates.
- Recommended pattern: `feat/task-<task-number>-<shortname>`.
- Example: `feat/task-1-executor-research-ui-config`.
- Keep one cohesive task slice per branch/PR.
- Open PR into `main`.
- If CI fails, iterate on the same branch until green, then merge.
- Preferred merge style: squash merge.
- Delete merged feature branch.

### Per-Task Development Loop
1. Sync branch base:
   - `git checkout main`
   - `git pull --ff-only`
2. Create task branch:
   - `git checkout -b feat/task-<task-number>-<shortname>`
3. Implement code + tests for the task scope.
4. Run verification before pushing:
   - `pnpm run lint`
   - `pnpm run build`
   - `pnpm run test:unit`
   - If vision code changed: `cd services/vision && poetry run pytest`
   - If solver code changed: `cd services/solver && cargo fmt -- --check && cargo clippy -- -D warnings && cargo test`
   - Optional high-confidence check: `pnpm run ci:verify:mock`
5. Commit focused changes with clear message.
6. Push branch and create PR.
7. Resolve CI failures (if any) until all required checks pass.
8. Merge PR, then move to next task from latest `main`.

### Handoff Requirements (Agent-to-Agent Continuity)
- Update `progress.md` at the end of each merged task with:
  - Task(s) completed.
  - Branch/PR reference.
  - Verification commands run and outcomes.
  - Known risks or follow-up tasks.
- On `feat/task-*` branches, the handoff update also requires:
  - `AGENTS.md` updated to reflect current milestone and sequencing.
  - `progress.md` updated with milestone and task state.
  - A `check:handoff` command run before push.
- Keep `.kiro/specs/coinpoker-macos-autonomy/tasks.md` checkboxes aligned with
  real completion status.
- In any handoff note, always include:
  - Current active branch.
  - Next task ID/name.
  - Exact next command to run.
- Repository guardrail (recommended):
  - `git config core.hooksPath .githooks`
  - `chmod +x .githooks/pre-push scripts/check-task-handoff-docs.sh`
  - The pre-push hook runs `pnpm run check:handoff` and blocks task-branch pushes when
    AGENTS.md and progress.md were not updated against `origin/main`.

## Cash-Game Readiness Playbook (Phases 8-12)

Use this section as the authoritative runbook. When the user says "start phase X",
follow the steps and scope below without re-negotiating the plan.

Historical note:
- This playbook reflects the completed phase-8..12 hardening track.
- For current CoinPoker autonomy implementation, follow `## Active Workflow (Current Phase: CoinPoker macOS Autonomy)` above.
- Do not use legacy `agent-zero/*` branch names for new task branches; use `feat/*`.

### Global Workflow
- Base branch: `agent-zero/phase7-golden-replay-pack-20260111` until a later phase
  branch is merged; if unsure, confirm the latest phase branch with the user.
- Branch naming:
  - Phase 8: `agent-zero/phase8-vision-solver-client-integration-YYYYMMDD`
  - Phase 9: `agent-zero/phase9-time-budget-preemption-hardening-YYYYMMDD`
  - Phase 10: `agent-zero/phase10-executor-action-verification-YYYYMMDD`
  - Phase 11: `agent-zero/phase11-observability-health-controllers-YYYYMMDD`
  - Phase 12: `agent-zero/phase12-decision-pipeline-e2e-YYYYMMDD`
- Commit style: one focused commit per phase unless explicitly asked otherwise.
- Always keep `git status -sb` clean after tests; delete generated fixtures if any.
- Default test command for new specs:
  - `pnpm --filter @poker-bot/orchestrator exec vitest run <spec path>`

### Phase 8: Vision & Solver Client Integration (Priority: HIGH)
Scope:
- Add vision client communication tests.
- Add solver gRPC client tests.
- Test timeout/retry behavior.
- Test network failure recovery.
- Test partial response handling.
- Test connection failures and reconnection.

Implementation notes:
- Use in-process gRPC servers with `@grpc/grpc-js` and generated service defs:
  `visionGen.VisionServiceService`, `solverGen.SolverService`. Bind to
  `127.0.0.1:0` and close in `afterAll`.
- Add optional deadline + retry support in client methods if needed to test
  timeout/retry behavior. Treat `UNAVAILABLE` and `DEADLINE_EXCEEDED` as
  retryable; cap at 1 retry with a short backoff.
- Vision tests should validate: `captureAndParse` mapping defaults, action button
  transforms, health check success/fail, empty result handling, and server down.
- Solver tests should validate: `solve` happy path, `waitForReady` timeout,
  error propagation, normalization of unknown action types, and server restart.

Files:
- `packages/orchestrator/src/vision/client.ts`
- `packages/orchestrator/src/solver_client/client.ts`
- `packages/orchestrator/test/vision/client.spec.ts` (new)
- `packages/orchestrator/test/solver/client.spec.ts` (new)

Commit message:
- `feat(test): add vision + solver client integration coverage`

### Phase 9: Time Budget & Preemption Hardening (Priority: HIGH)
Scope:
- Test `applyOverrun()` cascade (can reduce GTO budget to 0).
- Test component allocation never goes negative.
- Test preemption with <100ms remaining.
- Ensure downstream components never go negative.
- Add global preemption signal when total budget <100ms.

Implementation notes:
- Extend `TimeBudgetTracker` with a global preempt helper (e.g.,
  `shouldPreemptTotal(thresholdMs = 100)`), or explicitly test existing
  `remaining()` logic in the StrategyEngine preemption path.
- Add tests for `recordActual()` with overrun cascades and `remaining()` clamps.

Files:
- `packages/orchestrator/src/budget/timeBudgetTracker.ts`
- `packages/orchestrator/test/budget/timeBudgetTracker.spec.ts` (extend)

Commit message:
- `feat(test): harden time budget preemption edge cases`

### Phase 10: Executor & Action Verification (Priority: MEDIUM-HIGH)
Scope:
- Test compliance check failing.
- Test window manager returning null.
- Test vision timeout during turn-state check.
- Test bet sizing failure in raise actions.
- Test retry logic reaching max retries.
- Verify action amount validation for raises.

Implementation notes:
- Add unit tests for both `SimulatorExecutor` and `ResearchUIExecutor`.
- Mock `ComplianceChecker`, `WindowManager`, and `ActionVerifier` to force error
  paths (null window, verifier mismatch, and retry cap).
- Validate raise sizing errors surface as failures and are not swallowed.

Files:
- `packages/executor/src/simulators/simulator.ts`
- `packages/executor/src/research_bridge.ts`
- `packages/executor/test/*` (extend existing or add new)

Commit message:
- `feat(test): cover executor error paths and retries`

### Phase 11: Observability & Health Controllers (Priority: MEDIUM)
Scope:
- Add unit tests for `SafeModeController`.
- Add unit tests for `PanicStopController`.
- Test `AlertManager`.
- Test `ObservabilityService`.
- Test multi-trigger scenarios and state transitions.

Implementation notes:
- Add tests for idempotent transitions (already in safe mode, already panic).
- Verify alert emission on threshold crossings and config updates.
- Exercise `ObservabilityService.applyConfig()` and `flush()` behavior.

Files:
- `packages/orchestrator/src/health/safeModeController.ts`
- `packages/orchestrator/src/health/panicStopController.ts`
- `packages/orchestrator/src/observability/alertManager.ts`
- `packages/orchestrator/src/observability/service.ts`
- `packages/orchestrator/test/health/*` (extend)
- `packages/orchestrator/test/observability/*` (new)

Commit message:
- `feat(test): add observability + health controller coverage`

### Phase 12: Decision Pipeline E2E & Final Integration (Priority: MEDIUM)
Scope:
- Decision pipeline E2E test for `decision/pipeline.ts`.
- Test GTO solver timeout with 0ms budget.
- Test agent coordinator timeout.
- Test empty legal actions scenario.
- Test concurrent GTO + agent budget exhaustion.
- Fix `createSafeFallbackSolution()` to return proper frequency distribution.
- Validate GTO dist has >0 actions before blending.
- Final integration and stress testing (CI-smoke + long-run).
- Documentation updates and sign-off.

Implementation notes:
- Create a CI-safe integration suite (50-100 hands) and guard 1000+ hand stress
  with an env flag (e.g., `E2E_LONG_RUN=1`) so CI remains fast.
- Update `AGENT_ZERO_ISSUES.md` and `AGENT_ZERO_REVIEW.md` with phase status.
- Keep performance benchmarks in the long-run path only.

Files:
- `packages/orchestrator/src/decision/pipeline.ts`
- `packages/orchestrator/test/decision/pipeline.spec.ts` (new)
- `packages/orchestrator/test/integration/*` (new)
- `AGENT_ZERO_ISSUES.md`
- `AGENT_ZERO_REVIEW.md`

Commit message:
- `feat(test): add decision pipeline e2e + final integration gate`
