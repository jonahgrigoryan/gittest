# Task 15 – Evaluation Framework Spec

## Goal & Deliverables

- Produce `task15_implementation_outline.md` describing how to build offline evaluation, shadow mode, and A/B testing harnesses satisfying Req. 9.1–9.8.
- Reference concrete files/modules (existing and new) so a coding agent can implement without guesswork.

## Plan

1. **Scope & Requirements Mapping**  

- Summarize Task 15 objectives (smoke simulator, 10 M-hand suite, shadow harness, A/B tests) and tie each to Req 9.x acceptance gates plus win-rate/ε targets.  
- Note dependencies on earlier assets (Task 12 RNG, Task 13 replay types) and identify data inputs (`results/hands/<session>/hand_records.jsonl`, `packages/shared/src/replay.ts`).

2. **Workspace & Package Scaffolding**  

- Create `packages/evaluator/` with `package.json`, `tsconfig.json`, `src/`, `test/`, mirroring repo standards.  
- Add build/lint/test scripts, set entry (`src/index.ts`) exporting harness APIs.  
- Update root `pnpm-workspace.yaml`, `package.json` scripts, and CI commands to include the evaluator package (lint/test/build hooks).  
- Document required dependencies (`@poker-bot/shared`, orchestrator pipeline) and ensure TypeScript references compile.

3. **Shared Evaluation Primitives & Config Schema**  

- Define new types in `packages/shared/src/evaluation.ts` (evaluation modes, opponent profiles, run config, hand metrics, aggregate reports) and export via `packages/shared/src/index.ts`.  
- Extend config types (`packages/shared/src/config/types.ts`), loader/index (`packages/shared/src/config/index.ts`, `loader.ts`), and `config/schema/bot-config.schema.json` to add an `evaluation` block (smoke/offline/shadow/abTest knobs, opponent presets, target metrics).  
- Update orchestrator bootstrap (`packages/orchestrator/src/config/index.ts` or equivalent) to expose the new config data, and amend `config/bot/default.bot.json` plus config validator tests.

4. **Offline Simulator & Opponent Profiles**  

- Specify deterministic minimal simulator in `packages/evaluator/src/simulator/minimal.ts` that consumes `StrategyDecision`, advances state, and exposes hooks for opponent policies.  
- Lay out opponent interfaces and stock bots (`tightAggressive`, `loosePassive`, `mixedGTO`, `baselineCFRProxy`) under `packages/evaluator/src/opponents/`.  
- For `baselineCFRProxy`, clarify whether it loads policy snapshots from `services/solver/policies/*.json` or queries the live solver API; provide placeholder path plus load/validation steps.  
- Include bankroll/exploitability tracking helpers plus tests in `packages/evaluator/test/opponents.spec.ts`.

5. **Evaluation Harness Core & Data Sources**  

- Define `EvaluationHarness` in `packages/evaluator/src/harness.ts` orchestrating hands via `packages/orchestrator/src/decision/pipeline.ts`.  
- Describe runners: `OfflineSmokeRunner` (CI-friendly, ≤5k hands), `OfflineSuiteRunner` (10 M suite with checkpointing), `ShadowModeRunner` (iterates over `results/hands/<session>/hand_records.jsonl` via `packages/orchestrator/src/replay/reader.ts`), `ABTestRunner` (lockstep configs, CI math).  
- Specify ingestion helpers for shadow mode that reuse `readHandRecords` and `ReplayResult` structures; clarify metadata linking to recorded `HandRecord.rawGameState` and `@poker-bot/shared/replay` types.  
- Define result persistence layout under `results/eval/<runId>` with summary JSON, CSV metrics, config snapshot.

6. **Telemetry, Logger & Proto Integration**  

- Introduce `EvaluationRunMetadata` and explain how to append it to `HandRecord` structures plus logger structs in `packages/logger/src/hand_history.ts`, exporters, and related tests (`packages/logger/test/hand_history.spec.ts`, `retention.spec.ts`).  
- Document schema updates for shared logging types (`packages/shared/src/types.ts`, `packages/shared/src/replay.ts`) and ensure `proto/logging.proto` (and any other affected protos such as `proto/agents.proto` if metadata is surfaced there) gain matching fields.  
- Remind the agent to run `pnpm run proto:gen` so generated files under `packages/*/src/gen/` pick up the new metadata.

7. **CLI & Integrations**  

- Outline CLI entry `packages/evaluator/src/cli/eval.ts` with commands `smoke`, `offline`, `shadow`, `ab-test`, shared flags (config path, opponents, hand caps, seed, output).  
- Wire CLI into `packages/evaluator/package.json` and root `package.json` scripts (`pnpm eval:smoke`, etc.).  
- Document how CLI resolves inputs (e.g., `--sessionId` to locate `results/hands/session_<id>/hand_records.jsonl` via `findHandRecordFile`).

8. **Testing, Docs, Acceptance Gates**  

- Enumerate Vitest suites (`packages/shared/test/evaluation.spec.ts`, `packages/evaluator/test/harness.spec.ts`, CLI spec) covering CI math, opponent dispatch, harness stop conditions, schema validation, CLI parsing.  
- Capture manual verification steps (seeded smoke run, shadow harness vs recorded session, sample A/B diff).  
- Update `docs/evaluation.md`, `task15_check.md`, `progress.md`, and `tasks.md` with acceptance criteria coverage and runbook instructions.
