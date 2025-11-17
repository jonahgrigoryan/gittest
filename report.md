# Task 16 – Deployment & Environment Integration Report

## Summary
- Added a reusable multi-stage Dockerfile (`infra/docker/workspace.Dockerfile`) that can package any workspace with pinned Node 20.17, build metadata labels, and a deterministic runtime entrypoint. Solver and vision services now ship with dedicated Dockerfiles plus health-aware entrypoints.
- Introduced root `.env.example` and service-scoped `env/.env.*` files covering orchestrator, agents, executor, logger, evaluator, solver, and vision knobs, with a companion reference doc (`docs/env.md`) for rotation guidance.
- Rebuilt the Compose stack (`infra/compose/docker-compose.yml`) to orchestrate solver + vision + orchestrator + evaluator with shared volumes, health checks, and `WAIT_FOR` wiring. Added `docs/deployment.md` as the operational runbook and `config/models/.gitkeep` to keep the model volume present.
- Updated solver/vision runtimes to honor env-configured ports, ensuring the orchestrator can connect within Docker or k8s clusters.

## Testing / Verification
- `pnpm --filter "@poker-bot/shared" test`
- `pnpm --filter "@poker-bot/logger" test`
- `pnpm --filter "@poker-bot/orchestrator" test`
- `pnpm --filter "@poker-bot/orchestrator" build`
- `pnpm --filter "@poker-bot/agents" test`
- `pnpm --filter "@poker-bot/executor" test`
- `cargo fmt` && `cargo test` inside `services/solver`
- `cd services/vision && poetry install && poetry run pytest` (optional smoke)

# Task 13 – Replay Harness & Evaluation Prep Report

## Summary
- Added shared replay/report interfaces plus streaming HandRecord readers and a `deserializeGameState` helper so logged JSONL entries can be rehydrated exactly.
- Extracted the orchestrator decision pipeline into `decision/pipeline.ts`, built a `ModelVersionValidator`, and implemented a `ReplayEngine` that compares actions, RNG seeds, blended distributions, timing, and model versions per hand while aggregating batch statistics.
- Introduced a `pnpm --filter "@poker-bot/orchestrator" replay …` CLI that loads the production config/solvers/strategy engine, locates session JSONL files, validates model versions (strict mode optional), and emits JSON reports for offline analysis—closing Req. 9.x / 10.3.
- Updated `docs/replay.md`, `task13_check.md`, and `progress.md` to describe the workflow and verification steps.

## Testing / Verification
- `pnpm --filter "@poker-bot/shared" test`
- `pnpm --filter "@poker-bot/orchestrator" lint`
- `pnpm --filter "@poker-bot/orchestrator" test`
- `pnpm --filter "@poker-bot/orchestrator" build`
- Manual CLI smoke:
  - `pnpm --filter "@poker-bot/orchestrator" replay --sessionId <session>`
  - `pnpm --filter "@poker-bot/orchestrator" replay --sessionId <session> --strict-versions`
