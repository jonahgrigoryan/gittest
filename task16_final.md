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

