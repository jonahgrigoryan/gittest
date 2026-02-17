# Project Progress & Workflow

## Current Focus (Updated: 2026-02-17)

- Brain stack is complete: solver, agent coordinator, strategy engine, replay, observability, deployment.
- Active implementation phase is CoinPoker macOS autonomy ("hands + eyes").
- Source of truth for upcoming work:
  1. `.kiro/specs/coinpoker-macos-autonomy/requirements.md`
  2. `.kiro/specs/coinpoker-macos-autonomy/design.md`
  3. `.kiro/specs/coinpoker-macos-autonomy/tasks.md`
  4. `docs/plans/2026-02-03-coinpoker-autonomy.md` (implementation details)
- Branch policy for all upcoming tasks: `feat/*` (ensures push-based CI triggers from `.github/workflows/ci.yml`).

## CoinPoker Autonomy Progress (Updated: 2026-02-17)

- **Task 5 – executor infrastructure checkpoint** (in-progress)
  Task 5 is the next live milestone (`[ ] Checkpoint - Ensure executor infrastructure tests pass`) and is the current handoff target before moving to live-vision integration.

- **Task 4 – nut.js input automation + coordinate scaling (Req 3.1–3.11, 12.1–12.5)**
  Implemented on branch `feat/task-4-nutjs-input-automation` (PR pending). Completed end-to-end input automation and Task 4 property coverage:
  - Added `InputAutomation` wrapper (`packages/executor/src/input_automation.ts`) with injectable mouse/keyboard provider, deterministic 1–3s pre-click delay, out-of-bounds click rejection, and single-path translation via `WindowManager.visionToScreenCoords(...)`
  - Added `WindowManager.visionToScreenCoords(...)` proportional scaling formula with `dpiCalibration`
  - Replaced bet input stubs in `packages/executor/src/bet_input_handler.ts` to use InputAutomation for click/clear/type flow (raise input owns click input + clear + type sequence)
  - Wired `ResearchUIExecutor` to use InputAutomation for real click flow and coordinate context updates; removed duplicate executor-side click delays
  - Wired factory injection in `packages/executor/src/index.ts` for `InputAutomation`/mouse-keyboard provider options with backward-compatible construction
  - Added Task 4 tests:
    - `packages/executor/test/bet_input_handler.spec.ts` (Properties 9, 10, 11, 12)
    - `packages/executor/test/input_automation.spec.ts` (Properties 31, 32 + pre-click delay determinism/range)
    - `packages/executor/test/research_bridge.spec.ts` (raise flow ordering, coordinate-context update, no duplicate delay)
    - `packages/executor/test/executor_config.spec.ts` (factory input-automation injection path)
  - Added executor dependency alias for nut.js package in `packages/executor/package.json`:
    - `@nut-tree/nut-js` mapped to `@nut-tree-fork/nut-js` for current registry availability
  Verification run (all passing):
  - `pnpm run lint`
  - `pnpm run build`
  - `pnpm run test:unit`

- **Task 3 – ComplianceChecker process detection (Req 2.6–2.11)**
  Merged to `main` via PR [#40](https://github.com/jonahgrigoryan/gittest/pull/40). Replaced compliance stubs with provider-backed real process detection and scanning:
  - Added injectable `ProcessListProvider` in `packages/executor/src/compliance.ts`
  - Added production `MacOSProcessListProvider` using AppleScript (`osascript`) with safe `ps -A` fallback
  - Enforced required-process running checks, active-process allowlist checks, prohibited indicator rejection using real process/window title inputs, and descriptive build-flag failure messaging for `RESEARCH_UI_ENABLED`
  - Preserved executor-facing contract compatibility (`isResearchUIModeAllowed`, `validateExecution`, `validateSite`, `isProcessProhibited`)
  - Wired `processNames` into compliance factory config and added optional dependency injection path via `createActionExecutor(..., dependencies.processListProvider)`
  - Added Task 3 property/unit coverage in `packages/executor/test/compliance.spec.ts` (Properties 5–8 + `validateExecution` contract behavior)
  Verification run (all passing):
  - `pnpm run lint`
  - `pnpm run build`
  - `pnpm run test:unit`

- **Task 2 – WindowManager AppleScript implementation (Req 2.1–2.5)**  
  Merged to `main` via PR [#39](https://github.com/jonahgrigoryan/gittest/pull/39). Replaced `WindowManager` stubs with AppleScript-backed discovery/focus/bounds behavior, added injectable `AppleScriptRunner` + production `OsaScriptRunner`, wired executor factory runner injection and window config mapping (`windowTitlePatterns` / `processNames` / `minWindowSize` with backward-compatible fallbacks), and added Task 2 property/unit coverage:
  - `packages/executor/test/window_manager.spec.ts` (Properties 1–3 via `fast-check`)
  - `packages/executor/test/research_bridge.spec.ts` (focus-before-action and focus-failure behavior)
  - `packages/executor/test/executor_config.spec.ts` (factory runner wiring + config mapping)
  Verification run (all passing):
  - `pnpm run lint`
  - `pnpm run build`
  - `pnpm run test:unit`

- **Task 1 – Extend ResearchUIConfig schema and validation**  
  Merged to `main` via PR [#37](https://github.com/jonahgrigoryan/gittest/pull/37). Included schema/type wiring, executor validation hardening, and follow-up security fixes (`undici`, solver `bytes`, vision `pillow`/`protobuf`) with CI green.

- **Task 0 – fast-check prerequisite for property tests**  
  Merged to `main` via PR [#38](https://github.com/jonahgrigoryan/gittest/pull/38). Added `fast-check` as a dev dependency in `@poker-bot/executor` and `@poker-bot/orchestrator`, plus trivial import/property tests:
  - `packages/executor/test/fast_check_import.spec.ts`
  - `packages/orchestrator/test/fast_check_import.spec.ts`
  Local verification run: `pnpm run lint`, `pnpm run build`, `pnpm run test:unit`.

## Completed Tasks

- **Task 1 – Scaffolding & Core Interfaces**  
  Set up the monorepo (shared/orchestrator/agents/executor/logger/services), established TypeScript + Rust toolchains, created shared poker/domain types, JSON-schema config, and gRPC codegen via ts-proto/tonic. Added lint/build/test scripts and pinned dependencies for reproducible builds.

- **Task 2 – Configuration Manager**  
  Implemented the shared `ConfigurationManager` with Ajv validation, chokidar-based hot reload, rollback safeguards, and a subscription API. Orchestrator now consumes the manager and can watch configs. Added an extensive Vitest suite for validator, reload, and subscription behavior.

- **Task 3 – Vision System & Game State Parser**  
  Delivered layout-pack schema/types, calibration helpers, and the Python vision service (capture, ONNX inference, occlusion/confidence analysis, gRPC server). Built the orchestrator vision client, parser, SafeAction logic, legal-action calculator, and vision golden tests. Verified with repo-wide lint/build/test plus `poetry run pytest` in `services/vision`.

- **Task 4 – GTO Solver & Integration**  
  Added cache fingerprinting/loader infrastructure, CFR-based subgame solver with deep-stack action abstractions, expanded solver proto + codegen, shared GTOSolution types, and end-to-end orchestrator wiring (cache-first solve flow with SafeAction fallback). Rust crate passes `cargo fmt | clippy | test`; TypeScript packages pass `pnpm` lint/build/test.
- **Task 5 – Agent Coordinator**  
  Delivered the full @poker-bot/agents package: persona registry + prompt builder, transport adapters (OpenAI + mock) with parallel querying, strict JSON schema validation, Brier-weighted aggregation, cost guard & circuit breaker, and structured telemetry. Orchestrator wiring now consumes the coordinator output (or falls back to GTO) and AGENTS.md documents the workflow.
- **Task 6 – Time Budget Tracker**
  Implemented a reusable TimeBudgetTracker with per-component allocations, preemption logic, dynamic redistribution, and percentile metrics. Shared budget types now live in @poker-bot/shared, orchestrator exposes a `budget.createTracker()` helper, and GTO solver integration reserves/reclaims time based on remaining budget.

- **Task 7 – Risk Guard**
  Implemented bankroll and session limit enforcement with RiskGuard class, panic-stop behavior, and risk state persistence. Added comprehensive unit tests covering limit checking, exposure tracking, and SafeAction fallbacks per Requirement 10.4.

- **Task 8 – Strategy Engine**
  Delivered complete Strategy Engine with α-blending algorithm, deterministic action selection via seeded RNG, bet sizing quantization, divergence detection/logging, risk integration, and multiple fallback layers (SafeAction → GTO-only → panic stop). Includes full test suite and maintains 2-second deadline compliance.

- **Task 9 – Action Executor**
  Built the execution layer (simulator + research UI modes) with ActionExecutor interfaces, WindowManager, ComplianceChecker, bet input handler, and action verification pipeline. Orchestrator now optionally runs StrategyDecision through execution/verification based on config, schema defaults were expanded, and a dedicated report/task9.md document the rollout and tests.

- **Task 10 – Hand History Logger**
  Implemented the shared logging schema/serializers, production-ready `@poker-bot/logger` with redaction, exporters, metrics, retention, and orchestrator wiring that records every StrategyDecision + outcome for auditing. Config/schema extended with logging knobs; full logger/orchestrator test suites remain green.

- **Task 11 – Health Monitor & Safe Mode**
  Added shared health contracts/config, built HealthMonitor + SafeMode/PanicStop controllers with an optional dashboard, wired snapshot logging, and blocked the Action Executor whenever health degrades or panic stop triggers. Vitest suites now cover the new health modules.

- **Task 12 – Deterministic Replay & RNG Seeding**
  Added shared RNG helpers (`generateRngSeed/validateSeed`), made StrategyEngine + fallbacks + executors consume the standardized seed derived from `handId:sessionId`, and captured the value in every `HandRecord`. Wired a `ModelVersionCollector` so LLM/vision/cache versions are logged per hand, added replay documentation (`docs/replay.md`), plus new unit/integration tests covering RNG determinism, collector caching, and end-to-end replay guarantees (Req. 10.1/10.2).
- **Task 13 – Replay Harness & Evaluation Prep**
  Added shared replay/report types, a JSONL HandRecord reader, and extracted the decision pipeline for reuse. Built a `ModelVersionValidator`, `ReplayEngine`, and CLI (`pnpm --filter "@poker-bot/orchestrator" replay …`) that batch-replays logged hands, validates RNG seeds/model versions, computes divergence/timing deltas, and emits JSON reports—meeting Req. 9.x / 10.3 and Checkpoint 17.
- **Task 14 – Observability & Alerting**
  Implemented the structured observability stack: shared contracts/config, structured log sinks, observability reporter, alert manager, and orchestrator wiring that emits audit logs, metrics, and alerts for panic-stop / safe-mode / solver timeouts. Added docs plus CLI tools for replaying observability snapshots.
- **Task 15 – Evaluation Harness**
  Delivered the evaluation runner with smoke/offline/shadow/AB modes, CLI tooling, opponent registry, and metadata plumbing so evaluation runs are logged alongside hand histories.
- **Task 16 – Deployment & Environment Integration**
  Added deterministic Dockerfiles, solver/vision containers, a Compose stack, env/secrets governance (`.env.example`, `env/.env.*`), and deployment docs/runbooks so the full system can run via `docker compose up`.
- **Task 17 – Production Hardening & Operational Readiness**
  Wired real `AgentCoordinator` end-to-end with proper `AGENTS_USE_MOCK=1` support.
  - Agent wiring fixes:
    - `packages/orchestrator/src/main.ts`: Creates coordinator when `agents.models` non-empty OR `AGENTS_USE_MOCK=1`; injects synthetic `mock-default` model via config proxy.
    - `packages/orchestrator/src/cli/replay.ts`: Same pattern for replay mode.
    - `packages/evaluator/src/providers/pipeline.ts`: Same pattern for evaluation mode.
    - `packages/orchestrator/src/startup/validateConnectivity.ts`: `useMockAgents` option to skip agent-env checks in mock mode.
  - Proto tooling fixes:
    - `proto/buf.gen.yaml`: Uses `ts_proto` to match npm binary name.
    - Root `package.json`: `proto:gen` adds `node_modules/.bin` to `PATH`; `prebuild` behavior aligned for CI.
  - CI scripts:
    - `ci:verify`: full suite (includes vision + solver toolchains).
    - `ci:verify:mock`: mock mode with `REPLAY_TRUST_LOGS=1` and `ORCH_SKIP_STARTUP_CHECKS=1`.
  - Verification result: `pnpm run ci:verify:mock` passing.

## Workflow (Task-by-Task, Branch-per-Task)

1. Start from latest `main`:
   - `git checkout main`
   - `git pull --ff-only`
2. Create one feature branch per task slice:
   - `git checkout -b feat/task-<task-number>-<shortname>`
3. Implement code and tests for only that task scope.
4. Run verification locally (see checklist below).
5. Push branch; open PR to `main`.
6. If CI fails, fix on same branch and push again until green.
7. Merge PR (prefer squash), delete feature branch.
8. Repeat from latest `main` for the next task.

## Verification Checklist (per task/PR)

- Required baseline:
  - `pnpm run lint`
  - `pnpm run build`
  - `pnpm run test:unit`
- Conditional:
  - `cd services/vision && poetry run pytest` (when vision Python code changes)
  - `cd services/solver && cargo fmt -- --check && cargo clippy -- -D warnings && cargo test` (when solver Rust code changes)
- Optional high-confidence pre-PR:
  - `pnpm run ci:verify:mock`

All commands must pass before declaring a task complete.

## Active Backlog (CoinPoker macOS Autonomy)

- [x] Task 0: fast-check prerequisite for property tests
- [x] Task 1: Extend ResearchUIConfig schema and add validation
- [x] Task 2: Extend existing WindowManager with real macOS AppleScript implementation
- [x] Task 3: Extend existing ComplianceChecker with real macOS process detection
- [x] Task 4: Implement InputAutomation wrapper for nut.js and extend BetInputHandler
- [ ] Task 5: Checkpoint - Ensure executor infrastructure tests pass
- [ ] Task 6: Extend existing VisionClient with retry logic for live mode
- [ ] Task 7: Extend ResearchUIExecutor to use vision output
- [ ] Task 8: Implement vision service template loading and matching
- [ ] Task 9: Create CoinPoker layout pack with ROIs and templates
- [ ] Task 10: Checkpoint - Ensure vision integration tests pass
- [ ] Task 11: Implement GameLoop with hand fingerprinting
- [ ] Task 12: Implement CLI runner for live mode
- [ ] Task 13: Implement error handling and safety gates
- [ ] Task 14: Create coinpoker.bot.json configuration
- [ ] Task 15: Update operator documentation
- [ ] Task 16: Final checkpoint - Integration testing and validation

## Handoff Protocol (When Switching Coding Agents)

- Update this file (`progress.md`) at the end of every merged task with:
  - What was completed.
  - Branch and PR reference.
  - Verification commands run and results.
  - Remaining blockers/risks.
- Keep `.kiro/specs/coinpoker-macos-autonomy/tasks.md` checkboxes in sync with real completion state.
- Include in handoff message:
  - Current branch.
  - Next task to execute.
  - Exact next command to run.
- For `feat/task-*` branches, also ensure both `AGENTS.md` and `progress.md` are
  updated before final push. `pnpm run check:handoff` validates this against
  `origin/main`.
