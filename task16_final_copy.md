# Task 16 – Deployment & Environment Integration Plan

This document translates the Task 16 checklist into an actionable implementation plan and captures the related prep work for the optional Task 17 hardening pass. The goal is to package the poker bot into production-grade containers, provide deterministic orchestration, and formalize environment configuration so the system can run end-to-end without ad‑hoc setup.

## Objectives Recap

1. **Containerization**
   - Author deterministic Dockerfiles for each workspace (orchestrator, evaluator, agents, executor, logger, shared/lib).
   - Pin base images, OS packages, Node versions, and pass build metadata (git SHA, build timestamp).
2. **Orchestration**
   - Define a Docker Compose (or equivalent) stack that wires services over gRPC/HTTP, including solver stubs, vision service, and evaluation harness.
   - Configure shared volumes for cached solver data, configs, and log/results directories.
   - Expose ports and health checks so CI/CD can probe readiness.
3. **Environment & Secrets Management**
   - Centralize `.env` files (root + per-service overrides) enumerating every required variable.
   - Document API key rotation and credential mount strategy (e.g., bind secrets into containers via env or Docker secrets).
4. **Operational Runbook**
   - Capture bootstrapping steps: building containers, running smoke/shadow/AB suites inside Compose, seeding caches, and verifying telemetry.
   - Map outstanding dependencies that must be live before orchestrator starts (gRPC solver, vision service, agent providers, DBs).

## Sequential Implementation Plan

### 1. Inventory Services & Dependencies

1.1. List all workspaces/binaries that must run in production:
   - `packages/orchestrator` (main bot runtime) – depends on solver gRPC service, vision client, logger, agents, executor.
   - `packages/agents` – LLM coordinating layer; requires external API keys.
   - `packages/executor` – interacts with poker interfaces or simulators.
   - `packages/logger` – hand history writer/exporters.
   - `packages/evaluator` – CLI and potential long-running evaluation worker.
   - Supporting services: `solver service` (gRPC), `vision service`, any data stores/cache.

1.2. Capture runtime inputs/outputs for each component (ports, directories, env vars). This informs Dockerfile ARG/ENV decisions and Compose service definitions.

### 2. Author Dockerfiles

2.1. Choose a base image (e.g., `node:20-bullseye` or Alpine) and pin the digest/major version.

2.2. Use multi-stage builds:
   - **Builder stage:** install pnpm, install dependencies (leveraging `pnpm fetch` + `pnpm install --offline`), run `pnpm build`.
   - **Runtime stage:** copy compiled `dist/` artifacts plus `node_modules --prod`, include entrypoint script, set `NODE_ENV=production`.

2.3. Bake metadata into labels:
   ```
   LABEL org.opencontainers.image.source="https://github.com/.../repo"
   LABEL org.opencontainers.image.revision=$GIT_SHA
   LABEL org.opencontainers.image.created=$BUILD_TS
   ```

2.4. Parameterize config paths and volumes (e.g., `/app/config`, `/app/results`, `/app/cache`). Document defaults in the Dockerfile comments.

2.5. For shared libraries (`@poker-bot/shared`), consider a base image that other services can `FROM` to avoid repeating dependency installs.

### 3. Build Docker Compose Stack

3.1. Define services:
   - `orchestrator` – depends_on solver, agents, vision, logger (if separate).
   - `solver` – gRPC service container (if external dependency not provided).
   - `vision` – from existing repo/service or stubbed image.
   - `agents` – optional microservice that exposes the multi-LLM coordinator over RPC.
   - `evaluator` – CLI runner triggered via `docker compose run`.
   - `logger` & `executor` – either embedded in orchestrator image or separate services depending on architecture.

3.2. Networking:
   - Use a shared network (`poker-bot-net`) so gRPC endpoints resolve by service name (`solver:50051`, `vision:50052`).
   - Map host ports only when needed (e.g., orchestrator dashboard, gRPC health endpoints).

3.3. Volumes:
   - Solver cache: `./config/cache:/app/config/cache`.
   - Logs/results: `./results:/app/results`.
   - Configs: mount read-only `./config:/app/config`.

3.4. Healthchecks & restart policies:
   - Each service should expose `/healthz` (HTTP) or gRPC health; Compose can use `CMD curl ...` or `grpc_health_probe`.
   - Set `restart: on-failure` for robustness.

### 4. Environment & Secrets Management

4.1. Create `.env.example` with every variable referenced across packages:
   - Solver endpoints (`SOLVER_HOST`, `SOLVER_PORT`).
   - Agent providers (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.).
   - Vision service URI.
   - Evaluation flags (`EVALUATION_RUN_ID`, etc.).
   - Logging destinations, telemetry toggles.

4.2. Document variable purpose, default, and rotation policy in `docs/env.md`:
   - Which team owns the secret?
   - How/when to rotate (e.g., monthly, after incident).
   - Where to store in production (AWS Secrets Manager, Vault).

4.3. Update code to prefer env-based overrides (if any hard-coded paths remain). Validate that Compose passes `.env` values into containers via `env_file`.

### 5. CI/CD Integration

5.1. Add workflows (GitHub Actions or similar):
   - Build + lint + test (existing) plus container build/push on main tags.
   - Compose smoke test (bring up stack with mocked services, run evaluator smoke command inside orchestrator container).

5.2. Cache dependencies to keep builds fast (`pnpm store` restoration).

5.3. Publish images to a registry (GHCR, ECR). Ensure tags follow semantic or git-sha scheme.

### 6. Operational Runbook & Validation

6.1. Update `docs/deployment.md` (new file if needed) with:
   - Prerequisites (Docker, Compose, env files, solver/vision endpoints).
   - Step-by-step to build images locally (`docker compose build`).
   - Commands to run smoke/shadow/AB suites in containers.
   - Troubleshooting (e.g., solver gRPC connection errors, volume permissions).

6.2. Provide example `docker compose up` flows:
   ```
   docker compose --profile solver up -d solver vision agents
   docker compose run --rm evaluator smoke --hands 100
   ```

6.3. Capture how to feed evaluation metadata env vars so logs are tagged correctly.

### 7. Optional Task 17 (Hardening)

If time permits after Task 16:
   - Add security scanning (Trivy) to CI.
   - Implement canary deploy scripts or Helm charts if targeting Kubernetes.
   - Build automated cache warmers / data seeding jobs.

## Recommended Implementation Order

1. **Service inventory + env audit** – ensures nothing is missed before writing Dockerfiles.
2. **Dockerfiles** – once images exist, Compose configuration becomes straightforward.
3. **Docker Compose + volumes + healthchecks** – wire containers together and verify local stack.
4. **Environment docs + `.env` scaffolding** – so teammates can run Compose without guesswork.
5. **CI/CD container builds** – freeze tooling before final verification.
6. **Runbook + validation passes** – document smoke tests, evaluation runs, and solver dependencies.
7. **(Optional) Task 17 hardening** – security scans, deployment automation, or Helm charts.

Following this sequence keeps the workstream parallelizable (Dockerfiles first, orchestration second, documentation last) while ensuring every dependency is captured before the final handoff.

---

## Additional Analysis & Implementation Checklist

### Component Inventory & Responsibilities

| Component | Entrypoint / Binary | Core Dependencies | Ports & Interfaces | Persistent Data | Critical Env Vars |
| --- | --- | --- | --- | --- | --- |
| `packages/orchestrator` | `node dist/main.js` (after `pnpm --filter @poker-bot/orchestrator build`) | Needs solver gRPC (`services/solver`), vision gRPC (`services/vision`), executor hooks, logger, shared config | gRPC client to solver (default `127.0.0.1:50051`), to vision (`0.0.0.0:50052`), optional HTTP dashboard | Config snapshot, solver cache mount, results/hands, risk state JSON | `BOT_CONFIG`, `CONFIG_WATCH`, `RISK_STATE_PATH`, `VISION_SERVICE_URL`, `SOLVER_ADDR`, `SESSION_ID`, `EVALUATION_*`, `ORCH_PING_*` |
| `packages/agents` | CLI/daemon invoked via orchestrator import | External LLM APIs (OpenAI, Anthropic), config weights, token budgets | HTTP(S) to provider APIs | Weight store path, model prompts | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AGENT_PROVIDER_TOKEN`, `AGENT_TIMEOUT_MS` |
| `packages/executor` | Library invoked in orchestrator; optional standalone CLI for research UI | OS automation (requires host capabilities) | Optional WebSocket/API endpoints | None unless research UI caches | `EXECUTOR_MODE`, `SIMULATOR_ENDPOINT`, `RESEARCH_UI_ALLOWLIST` |
| `packages/logger` | `HandHistoryLogger` started inside orchestrator | File system access for results/logs | Writes JSONL + exports; optional metrics server | `results/`, `logs/` volumes | `LOGGER_OUTPUT_DIR`, `LOGGER_SESSION_PREFIX`, `RETENTION_DAYS` |
| `packages/evaluator` | `pnpm --filter "@poker-bot/evaluator" exec node dist/cli/eval.js <cmd>` | Orchestrator pipeline (when wired), results directory for shadow mode | CLI-driven; writes JSON/CSV to `results/eval` | `results/eval/<runId>` | `EVAL_CONFIG_PATH`, `RESULTS_DIR`, `SESSION_ID` |
| `services/solver` (Rust) | `cargo run -p solver` / compiled binary | Requires solver cache, proto definitions | Exposes gRPC on `50051` (configurable) | `config/cache` volume | `SOLVER_PORT`, `SOLVER_CACHE_PATH`, `LOG_LEVEL` |
| `services/vision` (Python) | `poetry run python -m vision.server` | Requires ONNX models, layout packs | gRPC on `50052` + optional health endpoint | Layout/model files, temp working dir | `VISION_PORT`, `VISION_LAYOUT_DIR`, `VISION_MODEL_PATH` |

This matrix should seed both Dockerfiles (entrypoints + assets) and Compose service definitions.

### Dockerfile Requirements & Implementation Notes

1. **Node-based packages (`packages/orchestrator`, `packages/agents`, `packages/logger`, `packages/executor`, `packages/evaluator`, `packages/shared` base image):**
   - Use multi-stage builds with `node:20-bullseye` (pin sha) for builder, `gcr.io/distroless/nodejs20-debian11` or slim runtime.
   - Builder steps: `corepack enable`, `pnpm fetch`, `pnpm install --offline`, `pnpm run build`.
   - Runtime stage: copy `dist/`, `package.json`, `.npmrc`, `pnpm-lock.yaml`, node_modules (production).
   - Set `USER node` when possible; mount `/app/config`, `/app/results`, `/app/cache`.
   - Provide entrypoints:
     - Orchestrator: `CMD ["node","dist/main.js"]`.
     - Evaluator CLI image: `ENTRYPOINT ["node","dist/cli/eval.js"]`.
   - Label each image with git SHA/time; accept build ARGs `GIT_SHA`, `BUILD_TS`.

2. **Rust solver (`services/solver`):**
   - Multi-stage with `rust:1.81` builder and `debian:bookworm-slim` runtime.
   - Use `cargo build --release`; copy binary + config/proto assets.
   - Expose `50051`, ensure `grpc_health_probe` installed for health checks.

3. **Python vision service (`services/vision`):**
   - Base `python:3.11-slim`; install Poetry, run `poetry install --only main`.
   - Copy ONNX/model assets (maybe under `/app/models`) and layout packs from `config/layout-packs`.
   - Provide entrypoint `poetry run python -m vision.server --port $VISION_PORT`.

4. **Shared base image (optional):**
   - Build a `@poker-bot/base` image containing `node`, `pnpm`, `@poker-bot/shared` dist; other services `FROM` it to reduce duplication.

### Docker Compose Stack Upgrade Plan

Current `infra/compose/docker-compose.yml` only builds orchestrator for tests. Replace with a multi-service stack:

- **Networks:** single `poker-bot-net`.
- **Volumes:** `config`, `results`, `logs`, `solver-cache`, `model-cache`.
- **Services:**
  1. `solver`: image built from `services/solver`; mount `config/cache`; expose `50051`; healthcheck using `grpc_health_probe -addr=localhost:50051`.
  2. `vision`: built from `services/vision`; mount layout packs + models; expose `50052`.
  3. `agents`: Node service; depends on secrets; optionally fronted by gRPC/HTTP for orchestrator.
  4. `orchestrator`: depends_on solver/vision/agents; command `node dist/main.js`; environment from `.env`, volumes for config/results/logs; optional profile for evaluation vs production.
  5. `logger`: if split, mount same volumes; otherwise orchestrator handles logging.
  6. `executor`: optional container for simulator/research UI; requires host capabilities (may run with `network_mode: host` or `privileged: true` only when needed).
  7. `evaluator`: defined as a service with `profiles: ["eval"]`; run commands via `docker compose run --rm evaluator smoke --hands 100`.

Compose file should also:
  - Propagate `BOT_CONFIG` pointing to `/config/bot/default.bot.json`.
  - Map host directories: `./config -> /config:ro`, `./results -> /results`, `./logs -> /logs`.
  - Provide labelled healthchecks and restart policies.

### Environment & Secrets Governance

Create root `.env.example` plus service-specific `.env.orchestrator`, `.env.agents`, etc. Document the following variables (non-exhaustive):

- **Orchestrator runtime:** `BOT_CONFIG`, `CONFIG_WATCH`, `RISK_STATE_PATH`, `SESSION_ID`, `VISION_SERVICE_URL`, `SOLVER_ADDR`, `EVALUATION_MODE`, `EVALUATION_RUN_ID`, `ORCH_PING_SOLVER`, `ORCH_PING_VISION`.
- **Agents service:** `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `ANTHROPIC_API_KEY`, `AGENT_MAX_LATENCY_MS`, `AGENT_BUDGET_TOKENS`.
- **Evaluator CLI:** `EVAL_CONFIG_PATH`, `RESULTS_DIR`, `SESSION_PREFIX`, `SMOKE_HAND_CAP`.
- **Solver/vision:** `SOLVER_PORT`, `SOLVER_CACHE_PATH`, `VISION_PORT`, `VISION_MODEL_PATH`, `VISION_LAYOUT_PACK`.
- **Telemetry/logging:** `LOGGER_OUTPUT_DIR`, `LOGGER_RETENTION_DAYS`, `METRICS_EXPORTER`, `SENTRY_DSN` (if used).

For each, define:
1. Default (if any) and whether empty is allowed.
2. Owner/rotation cadence (LLM keys monthly, solver creds quarterly, etc.).
3. Storage/CI injection method (GitHub Actions secrets → Compose `.env`).

### CI/CD and Release Flow Enhancements

1. **Build & Test Stage:**
   - `pnpm lint`, `pnpm test:unit`, `pnpm --filter packages/vision test` (if available), `pnpm --filter packages/agents test`.
   - Add deterministic evaluation smoke test inside CI by running `pnpm --filter "@poker-bot/evaluator" exec tsx src/cli/eval.ts smoke --hands 100`.

2. **Container Build Stage:**
   - For each Dockerfile, run `docker build` with `--build-arg GIT_SHA`.
   - Push images tagged `ghcr.io/<org>/poker-orchestrator:sha-XXXX`.

3. **Compose Smoke Stage:**
   - `docker compose -f infra/compose/docker-compose.yml up -d solver vision`.
   - `docker compose run --rm orchestrator pnpm --filter @poker-bot/orchestrator test` (or run actual main with simulator mode).
   - `docker compose run --rm evaluator smoke --hands 200 --opponent tight_aggressive`.

4. **Promotion Rules:**
   - Block release if vision golden tests or SafeAction/RiskGuard/BudgetTracker tests fail.
   - Collect artifact logs/results for triage.

### Final Prep & Real-Use Testing Steps

1. **Implement Dockerfiles** for every service, run `docker build` locally, verify `node dist/main.js --version` etc.
2. **Upgrade Compose** using new Docker images, confirm `docker compose up orchestrator solver vision` works with sample config.
3. **Seed caches and models** inside mounted volumes (`config/cache`, `vision/models`), document steps.
4. **Generate `.env` files** (real values stored securely) and update docs.
5. **Run integrated smoke**:
   - `docker compose run --rm evaluator smoke --hands 100`.
   - `docker compose run --rm evaluator shadow --session <session_id>`.
6. **Update documentation**: `docs/deployment.md`, `docs/env.md`, `docs/evaluation.md` to reflect container workflows.
7. **CI updates**: open PR adding workflows + statuses; ensure GitHub Actions secrets ready.
8. **Optional production rehearsal**: run Compose stack on staging host, capture audit logs, verify risk-state persistence, confirm `results/hands` and `results/eval` volumes populate as expected.

Once these steps are complete, Task 16 is ready, and the project is prepared for real deployment or for Task 17 hardening.


