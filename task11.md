# Task 11 – Health Monitor & Safe-Mode Controls

**Objective:** Build a resilient `HealthMonitor` subsystem that continuously audits every orchestrator component, triggers automatic safe-mode/panic-stop reactions when confidence or bankroll limits are breached, and exposes real-time status signals (CLI + optional dashboard) for operators.

Task 11 begins immediately after Task 10 (Hand History Logger) so that logging/telemetry infrastructure already exists to persist health data. The deliverable must satisfy Requirements 7.2, 7.3, and 10.5 from `tasks.md`.

---

## Prerequisites & Dependencies

- Tasks 1–10 merged (vision through logging fully wired).
- `packages/orchestrator` already instantiates `TimeBudgetTracker`, `RiskGuard`, `HandHistoryLogger`, and the agent/solver/executor pipelines.
- Config manager exposes `monitoring.health` (will be extended in this task).
- Telemetry/logging streams (Task 10) available for emitting health events.
- Access to historical metrics (Task 10 session metrics) for thresholding.

Verification commands before declaring Task 11 complete:

```bash
pnpm --filter "@poker-bot/orchestrator" lint
pnpm --filter "@poker-bot/orchestrator" test
pnpm --filter "@poker-bot/orchestrator" build
# Optional when dashboard enabled
pnpm --filter "@poker-bot/orchestrator" run dev:health-dashboard
```

---

## Architecture Overview

1. **Shared Health Contracts (`packages/shared/src/health.ts`)**
   - Define `HealthStatus`, `HealthCheckDefinition`, `HealthSnapshot`, `SafeModeState`, `PanicStopReason`.
   - Exported via `packages/shared/src/index.ts` for orchestrator/tests/optional dashboard.
2. **Health Monitor Service (`packages/orchestrator/src/health/monitor.ts`)**
   - Registers component-specific checks (vision, parser, solver, agents, strategy, executor, logger, budget).
   - Runs periodic sweeps (default every 5s) and emits structured events.
   - Persists recent `HealthSnapshot`s for dashboard/API.
3. **Safe Mode Controller (`packages/orchestrator/src/health/safe_mode.ts`)**
   - Guards Action Executor + Strategy pipeline when health degrades; when active it locks Action Executor (returns SafeAction) while keeping vision/logging alive so operators can diagnose issues.
   - Allows manual exit via CLI hook or config flag.
4. **Panic Stop Engine (`packages/orchestrator/src/health/panic_stop.ts`)**
   - Enforces irreversible halt on persistent low vision confidence or bankroll/session limit breach.
   - Coordinates with RiskGuard + SafeModeController.
5. **Status Dashboard (optional) (`packages/orchestrator/src/health/dashboard.ts`)**
   - Lightweight HTTP + SSE endpoint streaming current health, recent hands, alerts.
   - Served only when `monitoring.health.dashboard.enabled` is true.
6. **Integration Points**
   - Hooks in `packages/orchestrator/src/main.ts`, `vision/loop.ts`, `solver`, `agent_client`, `execution`, `logging`, `riskGuard`.
   - Telemetry events forwarded to existing logger + `results/session_*/health.jsonl`.

---

## Detailed Step-by-Step Plan

### 1. Shared Health Interfaces & Config (Req 7.3)

1.1 **Add Health Types**
   - File: `packages/shared/src/health.ts` (new).
   - Define:
     ```ts
     export type HealthState = 'healthy' | 'degraded' | 'failed';
     export interface HealthStatus {
       component: string;
       state: HealthState;
       checkedAt: number;
       latencyMs?: number;
       details?: string;
       metrics?: Record<string, number>;
       consecutiveFailures: number;
     }
     export interface HealthSnapshot {
       overall: HealthState;
       statuses: HealthStatus[];
       safeMode: SafeModeState;
       panicStop?: PanicStopReason;
     }
     export interface HealthCheckDefinition {
       name: string;
       frequencyMs?: number;
       fn: () => Promise<HealthStatus>;
       concurrency?: 'serial' | 'parallel';
     }
     export interface SafeModeState {
       active: boolean;
       reason?: string;
       enteredAt?: number;
     }
     export interface PanicStopReason {
       type: 'vision_confidence' | 'risk_limit';
       detail: string;
       triggeredAt: number;
     }
     ```
   - Export helper `computeOverallHealth(statuses: HealthStatus[]): HealthState`.

1.2 **Expose Config Schema**
   - Update `config/schema/bot-config.schema.json`:
     - Add `monitoring.health` block with fields:
       - `intervalMs` (min 1000, default 5000)
       - `degradedThresholds` per component (e.g., `visionConfidenceMin`, `solverTimeoutMs`, `agentTimeoutRatio`, `executorErrorBudget`)
       - `safeMode`: `{ enabled: boolean, autoExitSeconds?: number }`
       - `panicStop`: `{ visionConfidenceFrames: 3, minConfidence: 0.99, riskGuardAutoTrip: true }`
       - `dashboard`: `{ enabled: boolean, port: 7777, authToken?: string }`
   - Mirror defaults in `config/bot/default.bot.json`.
   - Add TypeScript interface `HealthMonitoringConfig` to `packages/shared/src/config/types.ts`.

1.3 **Wire Config Manager**
   - Ensure `packages/orchestrator/src/config/index.ts` exposes `monitoring.health`.
   - Compute derived thresholds once at startup for reuse by monitor/panic stop modules.

### 2. Health Monitor Service (Req 7.3)

2.1 **Create Service Skeleton**
   - File: `packages/orchestrator/src/health/monitor.ts`.
   - Class `HealthMonitor` constructor args: `{ config: HealthMonitoringConfig, logger, onSnapshot?: (snapshot) => void }`.
   - Methods:
     - `registerCheck(def: HealthCheckDefinition)`
     - `start()` → begins interval loop using `setInterval`.
     - `stop()` → clears timers.
     - `getLatestSnapshot()` returns cached snapshot.
   - Each `HealthCheckDefinition` contains `name`, `frequencyMs?`, `fn: () => Promise<HealthStatus>`, `concurrency` (serialize per component). HealthMonitor must catch errors per check, increment `consecutiveFailures`, and emit a `failed` status with `details = error.message` rather than crashing the loop. Checks must run asynchronously (no long blocking work on the main loop); use `setTimeout`/promises so health sweep never exceeds its own interval.

2.2 **Implement Component Checks**
   - **Vision** (`packages/orchestrator/src/vision/loop.ts`):
     - Report last frame timestamp, average confidence, OCR latency.
     - Degrade when `overallConfidence < config.degradedThresholds.visionConfidenceMin` for N consecutive frames.
   - **Parser/GameState**:
     - Track `stateSyncErrorRate` (mismatched board/cards per 100 hands) via parser stats; degrade above configurable threshold.
   - **Solver Subsystem**:
     - Track queue depth, % solves exceeding budget, number of solver RPC failures.
   - **Agents**:
     - Monitor timeout ratio vs `agents.timeoutMs`, circuit breaker state, average coordinator latency.
   - **Strategy**:
     - Detect divergence > 30 pp (from Task 8), ratio of SafeAction fallbacks, bet-sizer failures.
   - **Executor**:
     - Pending commands, verification failure count, success rate per minute.
   - **RiskGuard**:
     - Remaining bankroll vs configured floors, drawdown slope.
   - **Logger**:
     - `HandHistoryLogger.flushLag`, file rotation errors, backlog size.
   - Each check writes metrics map for dashboard.

2.3 **Event Emission & Persistence**
   - Append every snapshot to `results/session_<id>/health.jsonl`.
   - Emit structured logs via existing telemetry logger (level WARN when overall != healthy).
   - Provide hook for dashboard SSE + CLI.
   - When overall state transitions from `healthy` → `degraded` or `failed`, immediately call `SafeModeController.enter(auto = true, reason = 'health_degraded')`. Safe mode remains active until two consecutive `healthy` snapshots are observed (tracked inside HealthMonitor) or a manual exit occurs. If state falls to `failed`, SafeModeController stays latched until manual override even after recovery snapshots.

2.4 **Unit Tests**
   - New file `packages/orchestrator/test/health/monitor.spec.ts`:
     - Mocks for check functions, verifies aggregation, interval scheduling, state transitions, snapshot caching.

### 3. Safe Mode Controller (Req 7.2)

3.1 **Controller Implementation**
   - File: `packages/orchestrator/src/health/safe_mode.ts`.
   - Responsibilities:
     - Maintain state machine: `inactive → active (auto)` or `active (manual) → inactive`.
     - Provide `enter(reason, options)`, `exit(manualOverride)`, `wrapExecutor(executeFn)`.
     - When active:
       - Block `ActionExecutor.execute*` calls (return SafeAction + log).
       - Keep logging + health monitoring running.
       - Allow limited read-only API (vision + solver).

3.2 **Integration Points**
   - `packages/orchestrator/src/main.ts`: instantiate `SafeModeController` and route through HealthMonitor.
   - `packages/orchestrator/src/execution/index.ts`: guard execute functions via controller.
   - Add CLI hook (maybe `process.on('SIGUSR2')`) or config command to exit safe mode manually.

3.3 **Auto Exit Logic**
   - If `safeMode.autoExitSeconds` set, schedule re-check requiring 2 consecutive healthy snapshots before resuming.
   - HealthMonitor keeps a small dequeue of snapshot states; once safe mode is active via auto trigger, it only exits when `snapshot.state === 'healthy'` for two successive intervals within the auto-exit window, otherwise it stays latched.

3.4 **Tests**
   - `packages/orchestrator/test/health/safe_mode.spec.ts`: verify executor blocking, manual override, auto-exit gating.

### 4. Panic Stop Engine (Req 10.5)

4.1 **Vision Confidence Trigger**
   - Track consecutive frames with `visionOutput.confidence.overall < panicStop.minConfidence`.
   - Source: `packages/orchestrator/src/vision/loop.ts` emits events onto `HealthMonitor`.
   - After N frames (default 3), call `PanicStopController.trigger({ type: 'vision_confidence', detail })`.
   - Panic stop should:
     - Active safe mode.
     - Notify orchestrator via structured event.
     - Halt `makeDecision` loop (reject new hands) until manual restart.

4.2 **Risk Limit Trigger**
   - Hook `RiskGuard` (`packages/orchestrator/src/safety/riskGuard.ts`):
     - When bankroll/session limit breached, call `panicStop.trigger({ type: 'risk_limit', detail })` **after** Task 7 protective exits fire (i.e., RiskGuard already forced SafeAction + logged exposure).
     - PanicStopController then:
       1. Logs the reason (structured event + HandHistory metadata reference).
       2. Forces SafeModeController.enter(`panic_stop`).
       3. Stops `makeDecision` loop from accepting new hands until manual reset.

4.3 **Panic Stop Controller**
   - File: `packages/orchestrator/src/health/panic_stop.ts`.
   - Methods: `trigger(reason)`, `reset()`, `isActive()`.
   - Once triggered, requires external manual reset (no auto-exit).
   - Persists state to `results/session_<id>/panic_stop.json`.

4.4 **Tests**
   - `packages/orchestrator/test/health/panic_stop.spec.ts`: cover both triggers, ensure idempotent, ensures safe mode activated, ensures orchestrator rejects new work.

### 5. Status Dashboard (Req 7.5 Optional)

5.1 **HTTP/SSE Server**
   - File: `packages/orchestrator/src/health/dashboard.ts`.
   - Use lightweight `fastify` or native `http`.
   - Endpoints:
     - `GET /health` -> latest snapshot JSON.
     - `GET /events` -> SSE stream for live updates.
     - `GET /recent-hands` -> last N entries from `HandHistoryLogger` metrics (Task 10).
   - Authentication: optional bearer token from config.

5.2 **Front-End Stub**
   - Static HTML under `packages/orchestrator/src/health/public/` showing status cards (overall + per-component), alert list (safe mode/panic stop), and recent activity timeline (last 25 hands with health snapshot IDs). Minimal CSS/JS stub acceptable.

5.3 **Wiring**
   - Start server when `config.monitoring.health.dashboard.enabled`.
   - Provide `close()` hook for graceful shutdown.

5.4 **Tests**
   - `packages/orchestrator/test/health/dashboard.spec.ts`: mocks monitor; verifies endpoints respond + SSE pushes updates.

### 6. Telemetry, Logging & Docs

6.1 **Telemetry Hooks**
   - Extend `packages/orchestrator/src/logging/telemetry.ts` to include new event types:
     - `health.snapshot`
     - `health.safe_mode`
     - `health.panic_stop`

6.2 **Hand History Augmentation**
   - Add optional `healthSnapshotId` reference to `HandRecord.metadata` (Task 10 types).
   - Useful for correlating degraded states with specific hands.

6.3 **Documentation Updates**
   - `report.md`: summarize Task 11 deliverables and operator workflow (enter/exit safe mode).
   - `progress.md`: add section for health monitoring progress.
   - `task11_check.md`: acceptance checklist (see DoD below).

6.4 **Main Loop Integration**
   - Update `packages/orchestrator/src/main.ts` to instantiate `HealthMonitor`, `SafeModeController`, and `PanicStopController` during startup.
   - Ensure `makeDecision` consults panic-stop status (returning SafeAction when latched) and exposes CLI telemetry for safe-mode transitions.

### 7. Testing & Verification Flow

7.1 **Unit Tests**
   - Monitor, safe mode, panic stop, dashboard modules as described above.

7.2 **Integration Tests**
   - Add `packages/orchestrator/test/health/integration.spec.ts`:
     - Simulate low confidence frames -> verify panic stop.
     - Simulate executor failure -> health degrade -> safe mode.
     - Ensure logging/metrics continue while executor blocked.

7.3 **Manual Validation**
   - Run orchestrator in dev mode with mocked feeds:
     - Force component failures and observe safe mode toggles.
     - Verify dashboard updates in browser.
     - Confirm panic stop prevents new hands until restart.

7.4 **CI Hooks**
   - Ensure new tests included in `pnpm --filter "@poker-bot/orchestrator" test`.
   - Optionally add GitHub workflow gate for health monitor tests.

---

## Definition of Done

1. **Shared Contracts & Config**
   - `packages/shared/src/health.ts` exports all health types + helpers.
   - Config schema + defaults updated; `HealthMonitoringConfig` consumed via config manager.

2. **Health Monitor Runtime**
   - `HealthMonitor` runs periodic checks, produces snapshots, and writes health logs.
   - Component checks cover vision, parser, solver, agents, strategy, executor, logger, risk/budget.

3. **Safe Mode & Panic Stop**
   - Safe mode blocks executor while allowing monitoring/logging; manual + automatic entry/exit implemented.
   - Panic stop triggers on (a) 3 consecutive low-confidence frames or (b) bankroll/session limit breach; requires manual reset.

4. **Status Outputs**
   - CLI/log telemetry shows health transitions.
   - Optional dashboard serves `/health` + `/events` when enabled.

5. **Documentation & Checklists**
   - `task11_check.md` lists acceptance criteria; `report.md` + `progress.md` updated.

6. **Testing**
   - All new unit/integration tests pass.
   - `pnpm --filter "@poker-bot/orchestrator" lint|test|build` succeed.
   - Manual smoke confirms safe mode and panic stop behaviors.

Once these deliverables are met and merged, Task 11 is ready for review, enabling downstream monitoring (Task 14) and operational readiness milestones.
