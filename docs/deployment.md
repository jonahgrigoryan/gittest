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

The `ci.yml` workflow now enforces the release gates described in Task 17:

1. **Build job**
   - `pnpm run verify:env`
   - `pnpm run ci:verify` (runs workspace lint/build/tests, orchestrator replay smoke on the versioned dataset `packages/evaluator/test/fixtures/session_test-session/hand_records.jsonl`, `poetry run pytest` inside `services/vision`, and `cargo fmt|clippy|test` inside `services/solver`)
   - `tsx tools/check-replay-report.ts` writes `results/verification.json` with action-match/divergence/timing stats; `tsx tools/check-artifacts.ts` ensures no secrets leaked into artifacts
2. **Security job**
   - `pnpm audit --prod`, `cargo audit`, `pip-audit`
   - `gitleaks`, `trivy`, SBOM generation + optional Cosign signing
3. **Docker job**
   - Builds orchestrator, solver, and vision images (Buildx) and tags them with `sha-<commit>` plus branch/tag names.
   - Pushes images when the workflow runs on `v*` tags.
4. **Compose smoke job**
   - Launches the full stack via `infra/compose` using `.env.ci`, waits for healthy orchestrator, and tears down containers.
5. **Release job (tags only)**
   - Downloads the SBOM artifact (and ensures a placeholder signature exists), publishes a GitHub Release with SBOM/signature + changelog, and notifies the observability webhook (if configured).

All jobs must pass before merges or tagged releases succeed.

## 8. Troubleshooting

| Symptom | Action |
| --- | --- |
| Orchestrator stuck on startup | Ensure `WAIT_FOR` targets are reachable (solver/vision healthy). |
| Solver container exits immediately | Check `SOLVER_PORT` and ensure ports aren’t already taken on the host. |
| Vision container missing models | Mount `config/models` with ONNX assets or update `VISION_MODEL_PATH`. |
| Missing logs/results | Confirm host directories exist and your user has write access. |

This runbook, together with `task16_check.md`, is the source of truth for reproducing production deployments locally or in CI.

## 9. Runtime Security & Monitoring

- **Falco/Runtime IDS**: deploy Falco (or your preferred container IDS) alongside the stack. Grant it access to the Docker socket and configure alerts for unexpected syscalls (e.g., orchestrator writing to disallowed paths or spawning shells). Shipping Falco’s events into the same observability channel keeps incident response unified.
- **Image provenance**: CI now emits SBOMs under `sbom/sbom.spdx.json` and (optionally) signs them with Cosign. Before promoting images, run `cosign verify --key <public-key> <registry>/<image>@<digest>` to ensure only trusted builds ship.
- **Secret hygiene**: bind mount read-only secret files, rotate keys on the cadence documented in `docs/env.md`, and re-run `pnpm run verify:env` after every change to catch typos before deploy.
- **Audit retention**: archive Falco logs, SBOMs, and Cosign signatures alongside the session logs in `results/` so every production run has a complete provenance trail.
