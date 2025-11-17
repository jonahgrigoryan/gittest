## Task 16 – Deployment & Environment Integration Checklist

- [ ] `.dockerignore` prevents node_modules/results/logs from bloating build contexts.
- [ ] `infra/docker/workspace.Dockerfile` builds any workspace via `WORKSPACE` / `START_COMMAND` args and injects build metadata labels.
- [ ] `services/solver/Dockerfile` + `services/vision/Dockerfile` provide runnable solver/vision containers with configurable ports.
- [ ] Solver binary respects `SOLVER_ADDR` / `SOLVER_PORT`; vision server respects `VISION_PORT` / `VISION_MODEL_PATH`.
- [ ] Compose stack (`infra/compose/docker-compose.yml`) wires solver, vision, orchestrator, and evaluator with shared networks, health checks, and bind mounts.
- [ ] Root `.env.example` plus `env/.env.*` document every required variable with safe defaults.
- [ ] Deployment docs (`docs/deployment.md`, `docs/env.md`) describe build/run steps, secret handling, and smoke tests.
- [ ] `config/models/.gitkeep` ensures the models directory exists for volume mounts.
- [ ] `task16.md`, `progress.md`, and `report.md` mention the deployment work and reference verification commands.
- [ ] Verification commands executed locally:
  - `pnpm --filter "@poker-bot/shared" test`
  - `pnpm --filter "@poker-bot/logger" test`
  - `pnpm --filter "@poker-bot/orchestrator" test`
  - `pnpm --filter "@poker-bot/agents" test`
  - `pnpm --filter "@poker-bot/executor" test`
  - `pnpm --filter "@poker-bot/orchestrator" build`
  - `cargo fmt && cargo test` in `services/solver`
  - `poetry run pytest` in `services/vision`
