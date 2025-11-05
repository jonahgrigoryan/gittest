# Project Progress & Workflow

## Completed Tasks

- **Task 1 – Scaffolding & Core Interfaces**  
  Set up the monorepo (shared/orchestrator/agents/executor/logger/services), established TypeScript + Rust toolchains, created shared poker/domain types, JSON-schema config, and gRPC codegen via ts-proto/tonic. Added lint/build/test scripts and pinned dependencies for reproducible builds.

- **Task 2 – Configuration Manager**  
  Implemented the shared `ConfigurationManager` with Ajv validation, chokidar-based hot reload, rollback safeguards, and a subscription API. Orchestrator now consumes the manager and can watch configs. Added an extensive Vitest suite for validator, reload, and subscription behavior.

- **Task 3 – Vision System & Game State Parser**  
  Delivered layout-pack schema/types, calibration helpers, and the Python vision service (capture, ONNX inference, occlusion/confidence analysis, gRPC server). Built the orchestrator vision client, parser, SafeAction logic, legal-action calculator, and vision golden tests. Verified with repo-wide lint/build/test plus `poetry run pytest` in `services/vision`.

- **Task 4 – GTO Solver & Integration**  
  Added cache fingerprinting/loader infrastructure, CFR-based subgame solver with deep-stack action abstractions, expanded solver proto + codegen, shared GTOSolution types, and end-to-end orchestrator wiring (cache-first solve flow with SafeAction fallback). Rust crate passes `cargo fmt | clippy | test`; TypeScript packages pass `pnpm` lint/build/test.

## Workflow

1. Capture detailed plan in `taskN.md` aligned with requirements/design docs.
2. Spin up parallel model branches (e.g., `cursor/implement-poker-bot-task-4-*`) to explore implementations.
3. Evaluate each branch locally: review diffs vs plan, run verification commands, list gaps.
4. Select the strongest branch, apply fixes, and run the full verification suite.
5. Push to a feature branch (`feat/taskN-*`), open PR, squash-merge into `main`, and retire exploratory branches.

## Verification Checklist (per task/PR)

- `pnpm -r --filter "./packages/**" run lint`
- `pnpm -r --filter "./packages/**" run build`
- `pnpm -r --filter "./packages/**" run test`
- `cd services/vision && poetry run pytest` (whenever Task 3 components change)
- `cd services/solver && cargo fmt && cargo clippy && cargo test` (whenever solver code changes)

All commands must pass before declaring a task complete.
