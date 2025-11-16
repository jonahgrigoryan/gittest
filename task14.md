# Task 14 – Monitoring & Observability Implementation Plan

## Step 1 – Shared Observability Contracts & Config

1. Create `packages/shared/src/observability.ts` defining:

- `LogLevel` enum (debug/info/warn/error/critical) + `shouldLog()` helper.
- `StructuredLogEvent`, `AuditEventPayload`, `MetricsSnapshot`, `AlertTriggerState`, `AlertTriggerConfig`, `AlertChannelConfig`, `makeDedupKey()` utility, and `createStructuredEvent()` factory.

2. Re-export the new symbols via `packages/shared/src/index.ts` so all packages share one contract.
3. Expand `packages/shared/src/config/types.ts` by adding `monitoring.observability`:

- `logs`: level + sinks (`console`, `file`, `webhook`) with detailed options (paths, size caps, retry policy, enable flags).
- `metrics`: `{ flushIntervalMs, maxRecentHands, emitHandSummaries }`.
- `alerts`: `{ enabled, cooldownMs, channels: AlertChannelConfig[], triggers: { panicStop, safeMode, solverTimeouts { threshold, windowHands }, agentCost { dailyUsd }, healthDegradedMs } }`.

4. Update `config/schema/bot-config.schema.json` to validate the new block (enum constraints, min/max values, URL pattern for webhook, positive integers for intervals, non-empty directories).
5. Extend `config/bot/default.bot.json` with conservative defaults (INFO level, console sink enabled, metrics flush 5000 ms, alerts disabled, empty webhook placeholders).
6. Add hot-reload plumbing: in orchestrator bootstrap, subscribe to `monitoring.observability` via `configManager.subscribe` so log level/sinks/alerts update without restart.
7. Create/extend shared config tests (`packages/shared/test/config.spec.ts`) that cover valid config, missing sink directories, invalid enums, negative thresholds.

## Step 2 – Structured Logging Infrastructure (`@poker-bot/logger`)

1. Define `LogSink` interface and implement sinks under `packages/logger/src/sinks/`:

- `consoleSink.ts`: severity → console method mapping, single JSON stringify, honors log level.
- `fileSink.ts`: rotating JSONL writer in `<outputDir>/audit`, tracks size, prunes oldest files beyond `maxFiles`, supports bounded queue + retry with jitter.
- `webhookSink.ts`: batches events, POSTs to configured URL, exponential backoff + circuit breaker so observability never blocks gameplay.

2. Implement `StructuredLogger` (`packages/logger/src/structuredLogger.ts`):

- Accepts `{ sessionId, baseComponent, level, sinks, queueSize }`.
- Provides `log(severity, event, payload)` + `child(componentOverride, defaultCtx)`.
- Applies `shouldLog`, enriches payload (timestamp, sessionId, component, dedup key), fans out to sinks with per-sink error isolation + drop-warn policy.
- Supports lifecycle (`start`, `stop`, `flushOutstanding`).

3. Add tests (`packages/logger/test/structured_logger.spec.ts`) covering level filtering, child inheritance, file rotation, webhook retry/circuit breaker, sink failure isolation.
4. Export logger + sink factories via `packages/logger/src/index.ts` for orchestrator consumption.

## Step 3 – Session Metrics & Observability Reporter

1. Enhance `packages/logger/src/metrics.ts`:

- Track new counters required by Req 6.8 (hands/hour throughput, solver timeout counts, fallback types, safe mode/panic stop counts, agent token/cost totals, execution success %, risk fallback counts).
- Expose granular record helpers (`recordDecisionTiming`, `recordFallback(reason)`, `recordAgentCost(summary)`, `recordSafeMode(active)`, `recordPanicStop()`, `recordSolverTimeout(duration)`, `recordExecutionResult(success)`).
- Update `snapshot()` to emit the richer `MetricsSnapshot` shape from Step 1 (latency quantiles + new counters).

2. Build `packages/logger/src/observabilityReporter.ts`:

- Constructor accepts `{ sessionId, metricsConfig, structuredLogger, metricsFilePath }`.
- Methods: `start()` (schedule flush interval), `stop()`, `recordDecision(handCtx)`, `recordAgentTelemetry(output)`, `recordHealthSnapshot(snapshot)`, `recordSafeModeEvent`, `recordPanicStop`, etc.
- Maintain rolling buffer of last `maxRecentHands` entries for alert diagnostics.
- `flush(now)` writes snapshot JSON to `<sessionDir>/metrics/latest.json`, emits `metrics_snapshot` log, returns snapshot for AlertManager.

3. Add tests (`packages/logger/test/observability_reporter.spec.ts`) validating rolling statistics, flush cadence, JSON persistence, and StructuredLogger interaction (use fake sink to capture events).

## Step 4 – Orchestrator Observability Service & Instrumentation

1. Create `packages/orchestrator/src/observability/service.ts`:

- Instantiate configured sinks, build `StructuredLogger` + `ObservabilityReporter`.
- Expose API: `log(component, severity, event, context)`, `recordDecisionContext(state, decision, gto, agents, execution, tracker)`, `recordAgentTelemetry()`, `recordHealthSnapshot()`, `flush(now?)`, `stop()`.
- Provide registration hook for AlertManager (Step 5) to receive snapshots/events.

2. Update `packages/orchestrator/src/main.ts` bootstrap sequence to ensure prerequisites are explicit:

- Resolve `layoutPath` exactly like the vision loader (handle relative layout pack names → `<repo>/config/layout-packs`, fallback to simulator pack on failure).
- Resolve `cachePath` with `path.resolve(process.cwd(), "../../config", configManager.get("gto.cachePath"))` (or accept absolute path as-is).
- Instantiate `ModelVersionCollector` early using `{ configManager, cachePath: resolvedCachePath, layoutPath: resolvedLayoutPath, logger: console }`; reuse its output when logging decisions/alerts.
- Recreate RiskGuard wiring: build `RiskStateStore` (env `RISK_STATE_PATH` fallback), load persisted snapshot, instantiate `RiskGuard`, and wrap it with the `RiskGuardAPI` shim (methods `startHand`, `incrementHandCount`, `recordOutcome`, `checkLimits`, `getSnapshot`). Document that any observability/replay CLI must provide either the real shim (preferred) or a deterministic stub implementing the same interface before constructing `StrategyEngine`.
- Only after RiskGuardAPI, StrategyEngine, GTOSolver, CacheLoader, and ModelVersionCollector are ready, create the ObservabilityService so structured logs can include risk + model metadata.

3. Replace ad-hoc `console` logging with semantic events via the service (`decision_start`, `gto_solve_start/end`, `agent_query_start/end`, `strategy_select_action`, `fallback_applied`, `execution_result`, `risk_violation`, `panic_stop_triggered`, `safe_mode_entered/exited`). Call `recordDecisionContext` after each hand to feed reporter metrics (include RNG seed, timing breakdown, divergence, solver metadata, agent stats, execution info, RiskGuard snapshot, ModelVersionCollector output, health snapshot id).
4. Wire system components:

- `HealthMonitor` `onSnapshot` → `observabilityService.recordHealthSnapshot(snapshot)`.
- `SafeModeController`/`PanicStopController` emit CRITICAL events with gating reason + RiskGuard snapshot.
- `AgentTelemetryLogger` (or replacement) forwards sanitized agent outputs/failures to `observabilityService.recordAgentTelemetry`.

5. Add interval-driven flush (using `metrics.flushIntervalMs`) plus `process.on("beforeExit")` handler to flush reporter + sinks cleanly.
6. Tests (`packages/orchestrator/test/observability.spec.ts` new): simulate decision cycle with fake sinks, confirm RiskGuard stubs satisfy StrategyEngine construction, ModelVersionCollector paths propagate, flush interval works, and sink failures don’t bubble.

## Step 5 – Alerting Pipeline & Dashboard Integration

1. Implement `packages/orchestrator/src/observability/alertManager.ts`:

- Accept alert config, structured logger, and output channels (reuse webhook/file sink logic).
- Maintain last-fired timestamps per trigger to honor `cooldownMs`.
- Evaluate triggers on each `MetricsSnapshot` and discrete events (panic stop, safe mode, solver timeout spike counts > threshold within `windowHands`, agent cost exceeding daily limit, health degraded beyond `healthDegradedMs`). Emit `alert_dispatched` / `alert_suppressed` logs.

2. Integrate AlertManager with ObservabilityService: register it so `recordDecisionContext`, `recordHealthSnapshot`, and `flush()` provide data; allow dynamic enable/disable via config hot-reload.
3. Extend `HealthDashboardServer`:

- Subscribe to ObservabilityService to keep an in-memory ring buffer of recent structured logs + latest metrics snapshot + current alert state.
- Add endpoints `GET /observability/metrics`, `GET /observability/logs?limit=n`, `GET /observability/alerts`; gate via dashboard auth token when configured.
- Update UI templates to show metrics charts, alert banners, audit log tails, and status badges.

4. Dashboard/server tests (`packages/orchestrator/test/dashboard.spec.ts` updates): ensure new endpoints honor auth, return expected payloads, and alert banners appear when AlertManager fires.

## Step 6 – Documentation, Progress Tracking, Verification

1. Author `docs/observability.md` covering:

- Config reference (log levels, sinks, metrics flush, alert triggers) with JSON examples.
- Structured log schema plus sample `decision_complete` / `alert_dispatched` payloads.
- Operational guidance (rotating files, webhook setup, interpreting dashboard metrics, RiskGuard logging expectations).

2. Create `task14.md` describing objective, per-step checklist, verification notes; add `task14_check.md` enumerating acceptance tests (config validation, structured log smoke, metrics snapshot inspection, alert trigger simulation, dashboard endpoints/auth, webhook dry run captured).
3. Update `progress.md`, `report.md`, and `tasks.md` to reflect Task 14 status and highlight new observability capabilities.
4. Verification commands once implementation lands:

- `pnpm --filter "@poker-bot/shared" test`
- `pnpm --filter "@poker-bot/logger" test`
- `pnpm --filter "@poker-bot/orchestrator" lint`
- `pnpm --filter "@poker-bot/orchestrator" test`
- `pnpm --filter "@poker-bot/orchestrator" build`
- Manual dry-run: run orchestrator with `LOG_VERBOSE_AGENTS=1`, trigger synthetic panic stop + solver timeout + RiskGuard breach, confirm `results/session/audit/*.jsonl`, metrics snapshot file, dashboard endpoints, alert webhooks, and record evidence in `task14_check.md`.
