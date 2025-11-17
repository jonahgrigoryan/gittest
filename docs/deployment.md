# Deployment & Environment Runbook

Task 16 introduced a repeatable container workflow so the poker bot can run with a single `docker compose up`. This guide captures the build commands, environment expectations, and smoke tests.

## 1. Prerequisites

- Docker Desktop 24+ or any daemon that supports BuildKit.
- `pnpm@9` for local builds/tests.
- Access to required secrets: LLM keys, solver credentials, etc.
- Populate host directories: `config/`, `results/`, `logs/`, `config/cache/`, and (optionally) `config/models/` for ONNX packs.

## 2. Environment Files

1. Copy `.env.example` → `.env` and adjust shared paths/ports.
2. Update `env/.env.*` with service-specific overrides. These files are committed with placeholder values so Compose runs without secrets, but production deployments **must** inject the real credentials via your secret manager.

Refer to `docs/env.md` for the variable catalog.

## 3. Building Images

Each workspace uses the shared `infra/docker/workspace.Dockerfile`. Build orchestrator + tooling images via:

```bash
# from repo root
export GIT_SHA=$(git rev-parse HEAD)
export BUILD_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Orchestrator runtime
docker build \
  -f infra/docker/workspace.Dockerfile \
  --build-arg WORKSPACE=@poker-bot/orchestrator \
  --build-arg START_COMMAND="node dist/main.js" \
  --build-arg GIT_SHA=$GIT_SHA \
  --build-arg BUILD_TS=$BUILD_TS \
  -t poker-bot/orchestrator:dev .

# Library/test images (agents/logger/executor/shared) – swap WORKSPACE accordingly
for workspace in @poker-bot/agents @poker-bot/logger @poker-bot/executor @poker-bot/shared; do
  docker build -f infra/docker/workspace.Dockerfile \
    --build-arg WORKSPACE=$workspace \
    --build-arg START_COMMAND="pnpm --filter $workspace test" \
    -t poker-bot/$(echo $workspace | cut -d'/' -f2):dev .
done

# Solver (Rust) + vision (Python)
docker build -f services/solver/Dockerfile -t poker-bot/solver:dev .
docker build -f services/vision/Dockerfile -t poker-bot/vision:dev .
```

## 4. Compose Stack

Bring up the full stack (solver + vision + orchestrator) from `infra/compose`:

```bash
cd infra/compose
# Use the sample env for quick testing; swap with a secrets-backed file in production
docker compose --env-file ../../.env.example up --build orchestrator
```

Additional services:

- `solver` – gRPC CFR solver (Rust)
- `vision` – ONNX-based vision server
- `orchestrator` – main runtime, waits on solver/vision health
- `evaluator` – optional profile (`docker compose --profile tools run evaluator`)

Each container mounts host `config/`, `results/`, and `logs/` directories so artifacts are available after shutdown.

## 5. Smoke Tests

After Compose is running:

1. `docker compose ps` – verify solver and vision are healthy.
2. Tail orchestrator logs – confirm solver handshake and vision liveness.
3. Run evaluation smoke: `docker compose --profile tools run --rm evaluator` (shadow-mode replay of the latest session).
4. Inspect `results/hands` for new JSONL entries.

## 6. Secrets & Rotation

- Keep `.env` files out of source control (only `.env.example` is tracked).
- Inject real secrets via Docker/Compose `--env-file` or your orchestration platform’s secret manager.
- Rotate LLM keys monthly; update Compose env files and redeploy.

## 7. CI/CD Integration

Add the following jobs to your pipeline (pseudocode shown in `task16_check.md`):

1. `pnpm` lint/test/build for every workspace.
2. `docker build` for orchestrator/solver/vision images.
3. Compose smoke test: `docker compose --env-file .env.ci -f infra/compose/docker-compose.yml up --build -d orchestrator` followed by `docker compose down -v`.

## 8. Troubleshooting

| Symptom | Action |
| --- | --- |
| Orchestrator stuck on startup | Ensure `WAIT_FOR` targets are reachable (solver/vision healthy). |
| Solver container exits immediately | Check `SOLVER_PORT` and ensure ports aren’t already taken on the host. |
| Vision container missing models | Mount `config/models` with ONNX assets or update `VISION_MODEL_PATH`. |
| Missing logs/results | Confirm host directories exist and your user has write access. |

This runbook, together with `task16_check.md`, is the source of truth for reproducing production deployments locally or in CI.
