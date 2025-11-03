# Project Progress & Workflow

## Completed Tasks{"id":"json_schema.violation","message":"Function call payload did not satisfy the function signature. Errors: {\"command\":[\"Cannot apply patch to b/c patch should only modify existing files\"]}"}*** End Patch

- **Task 1 – Scaffolding & Core Interfaces**  
  Established the monorepo structure (shared/orchestrator/agents/executor/logger), set up TypeScript and Rust toolchains, added shared poker types, configuration schema/loader, and ts-proto/tonic gRPC stubs. CI scripts, lint/test/build commands, and pinned dependencies were added to guarantee reproducible builds.

- **Task 2 – Configuration Manager**  
  Built the shared `ConfigurationManager` with Ajv validation, hot-reload via chokidar, subscription callbacks, rollback on validation failure, and expanded config tests. Orchestrator now consumes the manager and can watch config files. All packages build/test/lint cleanly with the new dependency.

- **Task 3 – Vision System & Game State Parser**  
  Added layout-pack schema/types, calibration helpers, and a Python vision service (capture, ONNX inference, occlusion/confidence analysis, gRPC server). Orchestrator now has a vision client, parser, SafeAction logic, state-sync tracker, legal-action calculator, and comprehensive golden/safety tests. Shared vision types/gRPC stubs were generated, and the vision service has Poetry-managed deps. Verified with repo-wide lint/build/test plus `poetry run pytest` in `services/vision`.

## Workflow

1. **Planning** – Each task begins with a detailed plan (`taskN.md`) derived from `requirements.md`, `design.md`, and checkpoint docs.
2. **Parallel model branches** – Multiple AI coding agents (e.g., Cursor) each implement Task N on their own branch (`cursor/implement-poker-bot-task-3-XXXX`).
3. **Evaluation** – For each branch: pull, inspect diffs against the plan, run required commands (`pnpm` lint/build/test, Poetry tests, etc.), and note gaps.
4. **Selection & Fixup** – Choose the strongest branch, fix outstanding issues locally (dependency gaps, test failures, style), and run the full verification suite.
5. **Feature branch & PR** – Push final changes to a `feat/taskN-*` branch, squash merge into `main`, and delete the exploratory branches.

## Verification Checklist

- `pnpm -r --filter "./packages/**" run lint`
- `pnpm -r --filter "./packages/**" run build`
- `pnpm -r --filter "./packages/**" run test`
- `cd services/vision && poetry run pytest`

All four commands must pass before a task is considered complete and merged. This ensures TypeScript compilation, linting, unit/integration tests, and Python vision tests are all green.***
