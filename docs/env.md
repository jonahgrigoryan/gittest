# Environment & Secrets Reference

This document catalogs every environment variable introduced during Task 16 so staging/production stacks can be configured consistently. Copy `.env.example` to `.env`, update the `env/.env.*` files with real credentials, and load them via `docker compose --env-file <root-env> ...` or your orchestration platform.

## Global Variables (root `.env`)

| Variable | Description | Default | Notes |
| --- | --- | --- | --- |
| `RESULTS_DIR` | Host path for session/eval logs mounted into containers. | `./results` | Ensure the directory exists and is writable. |
| `LOGS_DIR` | Host path for structured logs. | `./logs` | Rotated by the logger package. |
| `CONFIG_DIR` | Source of JSON configs/layout packs. | `./config` | Always mounted read-only. |
| `CACHE_DIR` | Solver cache + generated models. | `./config/cache` | Persist between runs to avoid expensive warm-ups. |
| `HEALTH_DASHBOARD_PORT` | Port for the orchestrator health dashboard. | `7600` | Also surfaced inside observability service. |
| `OBSERVABILITY_PORT` | Port for structured observability endpoint. | `7700` | Used once Task 14 observability stack lands. |
| `SOLVER_HOST` / `SOLVER_PORT` | Address Compose uses when wiring orchestrator to solver. | `solver` / `50051` | Update for external solver clusters. |
| `VISION_HOST` / `VISION_PORT` | Host + port for the Python vision service. | `vision` / `50052` | |

Secrets such as `OPENAI_API_KEY` never belong in the root file—store them in the per-service `.env` files and rotate via your secret manager.

## Orchestrator (`env/.env.orchestrator`)

| Variable | Purpose |
| --- | --- |
| `SESSION_ID` | Unique identifier for the running session; persisted in hand logs. |
| `BOT_CONFIG` | Path inside the container to the bot config JSON. |
| `CONFIG_WATCH` | `1` to enable live reloads via `ConfigurationManager`. |
| `VISION_SERVICE_URL` | Full HTTP/gRPC URL for the vision proxy. |
| `SOLVER_ADDR` | gRPC target for the solver service. |
| `RISK_STATE_PATH` | File used by `RiskStateStore` for persistence. |
| `LOGGER_OUTPUT_DIR` | Destination for `HandHistoryLogger`. |
| `EVALUATION_MODE` / `EVALUATION_RUN_ID` | Control evaluation CLI behavior (Task 15). |
| `ORCH_PING_SOLVER` / `ORCH_PING_VISION` | Optional warm-up probes during startup. |

## Agents (`env/.env.agents`)

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | API keys for persona transports. |
| `OPENAI_BASE_URL`, `OPENAI_MODEL` | Allow routing to compatible OpenAI deployments. |
| `AGENT_MAX_LATENCY_MS` | Per-agent deadline enforced by coordinator. |
| `AGENT_BUDGET_TOKENS` | Safety budget for aggregator. |

## Executor (`env/.env.executor`)

| Variable | Purpose |
| --- | --- |
| `EXECUTOR_MODE` | `simulator` or `research_ui`. |
| `WINDOW_MANAGER` | `headless` or `desktop`. |
| `COMPLIANCE_CHECKER` | `strict` / `disabled`. |
| `SAFE_ACTION_FALLBACK` | Action used when verification fails. |
| `RESEARCH_UI_PORT` | UI port when the experiment surface is enabled. |

## Logger (`env/.env.logger`)

| Variable | Purpose |
| --- | --- |
| `LOGGER_OUTPUT_DIR` | JSONL hand history output path. |
| `LOGGER_RETENTION_DAYS` | Sliding retention applied by retention manager. |
| `METRICS_EXPORTER` | `json` / `stdout` / `prom`. |
| `ENABLE_REDACTION` | Toggle redaction (defaults to `1`). |

## Evaluator (`env/.env.evaluator`)

| Variable | Purpose |
| --- | --- |
| `HANDS_DIR` | Location of `session_<id>/hand_records.jsonl` directories. |
| `EVAL_OUTPUT_DIR` | Destination for evaluation summaries (`results/eval`). |
| `SESSION_PREFIX` | Prefix recorded in evaluation metadata. |
| `SMOKE_HAND_CAP` | Maximum hands for smoke tests. |

## Solver (`env/.env.solver`)

| Variable | Purpose |
| --- | --- |
| `SOLVER_PORT` | gRPC port exposed from the container. |
| `SOLVER_CACHE_PATH` | Directory for CFR cache snapshots (mounted volume). |

## Vision (`env/.env.vision`)

| Variable | Purpose |
| --- | --- |
| `VISION_PORT` | gRPC port for `vision.server`. |
| `VISION_MODEL_PATH` | Directory containing ONNX models. |
| `VISION_LAYOUT_PACK` | Default layout for parser sanity checks. |

## Secrets & Rotation Guidance

- **LLM API keys** → stored in your secret manager, rotated monthly. In CI, inject via GitHub Actions secrets → Compose `.env`.
- **Solver / Vision credentials** → (if external) rotate quarterly and mount as Docker secrets.
- **Session-level tokens (e.g., RNG seeds)** → automatically generated; do not persist outside `results/`.

Always audit environment diffs before deployment. The new `docs/deployment.md` includes smoke commands that verify env wiring end-to-end.
