# Task 10 – Hand History Logger

**Objective:** Build a production-ready hand history logging system that captures every decision from the orchestrator pipeline, persists the data safely, redacts sensitive fields, and produces exportable summaries + metrics with a configurable retention policy.

This picks up immediately after Task 9 (Action Executor). We now have `StrategyDecision` objects (and optional execution results) being produced in `packages/orchestrator/src/main.ts`. Task 10 wires a logging layer directly after each hand is decided/executed so downstream consumers (compliance, auditing, research) can inspect complete per-hand artifacts.

---

## Prerequisites & Dependencies

- Task 1–9 merged on `main` (all Strategy/Executor plumbing available).
- Packages needed: `@poker-bot/logger`, `@poker-bot/shared`, `@poker-bot/orchestrator`.
- Config scaffolding exists (`logging.retentionDays`, `logging.exportFormats`). Task 10 will extend this block.
- Results directory layout: `/results/session/<timestamp>/` already used by RiskGuard state; reuse or extend for logs.

Verification commands to run before declaring Task 10 complete:

```bash
# Package-level checks
pnpm --filter "@poker-bot/logger" lint
pnpm --filter "@poker-bot/logger" test
pnpm --filter "@poker-bot/logger" build

# Orchestrator regression suite (ensures logging wiring doesn’t regress core flow)
pnpm --filter "@poker-bot/orchestrator" test

# Optional: repo-wide lint/build/test if requested in PR checklist
pnpm -r run lint
pnpm -r run build
pnpm -r run test
```

---

## Architecture Overview

1. **Shared Types (`packages/shared/src/strategy.ts`)** – Already exports `StrategyDecision`. Task 10 will add `HandRecord`, `SessionMetrics`, `HandRecordMetadata` interfaces so orchestrator + logger share schemas.
2. **Logger Package (`packages/logger`)** – Implement actual logic:
   - `HandHistoryLogger` class that accepts decisions/execution info and writes redacted `HandRecord`s to append-only JSONL or binary log.
   - `Redactor` utilities for PII.
   - Exporters (JSON pretty, ACPC format).
   - Metrics aggregator (win rate, EV deltas, latency percentiles).
   - Retention manager to delete old log files.
3. **Orchestrator Integration** – In `packages/orchestrator/src/main.ts`, instantiate logger based on config, feed each completed hand (decision + execution result + GameState snapshots, solver/agent outputs).
4. **Config / Schema** – expand `logging` block to include:
   - `enabled`, `outputDir`, `sessionPrefix`
   - `redaction: { enabled, fields }`
   - `retentionDays` (already), `maxFileSizeMb`, `flushIntervalMs`
   - `metrics: { enabled, windowHands }`
5. **Tests** – Unit tests in `packages/logger/test` for every module; orchestrator integration smoke ensuring `HandHistoryLogger` is invoked.

---

## Detailed Step-by-Step Plan

### 1. Shared Types & Constants (Req 10.1, 10.2)

1.1 **Create Shared Strategy Logging Types**
   - File: `packages/shared/src/strategy.ts`
   - Add:
     ```ts
     export interface HandRecord {
       handId: string;
       sessionId: string;
       createdAt: number;
       rawGameState: GameStateSnapshot;   // minimal serializable view
       decision: StrategyDecision;
       execution?: ExecutionResult;
       solver?: GTOSolutionSummary;
       agents?: AggregatedAgentSummary;
       timing: StrategyTimingBreakdown;
       metadata: StrategyMetadata & {
         configHash: string;
         rngSeed: number;
         modelHashes?: Record<string, string>;
         redactionApplied: boolean;
       };
     }
     ```
   - Define `GameStateSnapshot`, `AggregatedAgentSummary`, `ExecutionResultSummary` (subset of executor result to avoid circular deps).
   - Export new interfaces via `packages/shared/src/index.ts`.

1.2 **Add `HandRecordSerializer` Contracts**
   - In `packages/shared/src/index.ts` or a new `logger.ts`, define minimal serializer/deserializer signatures so orchestrator + logger share them.

### 2. Logger Package Foundations (Req 10.1–10.2)

2.1 **Implement `HandHistoryLogger`**
   - File: `packages/logger/src/hand_history.ts`
   - Responsibilities:
     - Accept constructor config: `{ sessionId, outputDir, retentionDays, flushIntervalMs, logger }`.
     - Methods: `append(hand: HandRecord)`, `flush()`, `close()`.
     - Manage write buffer (JSON Lines) and ensures persistence within 1s (setInterval or scheduled flush).
     - Use Node streams (`fs.createWriteStream`) with names like `HH_<sessionId>_<timestamp>.jsonl`.
     - Track `lastPersistedAt` for metrics.

2.2 **Session Manager**
   - File: `packages/logger/src/session_manager.ts` (new)
   - Handles `sessionId` creation, log file rollover (if `maxFileSizeMb` exceeded), and retention enforcement (delete old logs).
   - Provide API to orchestrator: `createSessionLogger(botConfigLogging, runtimePaths)`.

2.3 **Redaction Utilities (Req 10.3)**
   - File: `packages/logger/src/redaction.ts`
   - Export `redactHandRecord(record: HandRecord, options: RedactionConfig): HandRecord`.
   - Remove/replace fields: player names → positions, IP addresses, site-specific IDs.
   - Add unit tests covering replacement and verifying metadata flag `redactionApplied`.

### 3. Exporters (Req 10.4)

3.1 **JSON Exporter**
   - Folder: `packages/logger/src/exporters/json.ts`
   - Function `exportToJson(record: HandRecord): string`.
   - Support pretty print toggle.

3.2 **ACPC Exporter**
   - File: `packages/logger/src/exporters/acpc.ts`
   - Convert `HandRecord` into ACPC hand history string (action sequence, board, winner).
   - May require helper to derive action list from `rawGameState.history`.
   - Add tests verifying formatting for multi-street hands.

3.3 **Exporter Registry**
   - `packages/logger/src/exporters/index.ts` exports `getExporter(format: LoggingFormat)`.
   - `HandHistoryLogger.append()` triggers exporters listed in config (e.g., JSON for base log, optional ACPC file per hand).

### 4. Metrics Aggregation (Req 10.5)

4.1 **MetricsCollector Class**
   - File: `packages/logger/src/metrics.ts`
   - Track streaming stats:
     - Win rate (bb/100) using net results from `HandRecord.execution` or GameState.
     - EV accuracy: compare chosen action vs solver EV.
     - Decision quality metrics (divergence, risk fallback count).
     - Latency histograms: maintain ring buffers for `gtoTime`, `agentTime`, `executionTime`.
   - Provide `getSessionMetrics(): SessionMetrics`.

4.2 **Expose Metrics Exports**
   - `HandHistoryLogger` updates metrics per append.
   - Optionally writes periodic summary file `session_metrics.json`.

4.3 **Unit Tests**
   - New test file `packages/logger/test/metrics.spec.ts` verifying aggregator math.

### 5. Retention Policy (Req 10.6)

5.1 **Retention Manager**
   - File: `packages/logger/src/retention.ts`
   - Function `enforceRetention(outputDir, retentionDays): Promise<void>` scanning for log files older than threshold.
   - Called on startup (before logging) and on schedule (daily).

5.2 **Config Support**
   - Extend `config/schema/bot-config.schema.json` logging section with:
     ```json
     "enabled": { "type": "boolean", "default": true },
     "outputDir": { "type": "string", "default": "../../results/hands" },
     "sessionPrefix": { "type": "string" },
     "flushIntervalMs": { "type": "integer", "minimum": 100, "default": 250 },
     "maxFileSizeMb": { "type": "integer", "minimum": 1, "default": 50 },
     "redaction": {
       "type": "object",
       "properties": {
         "enabled": { "type": "boolean", "default": true },
         "fields": { "type": "array", "items": { "enum": ["playerNames", "ids", "ipAddresses"] } }
       }
     },
     "metrics": {
       "type": "object",
       "properties": {
         "enabled": { "type": "boolean", "default": true },
         "windowHands": { "type": "integer", "minimum": 1, "default": 200 }
       }
     }
     ```
   - Mirror defaults in `config/bot/default.bot.json`.

### 6. Orchestrator Integration

6.1 **Instantiate Logger**
   - `packages/orchestrator/src/main.ts`
     - After config load, add:
       ```ts
       const loggingConfig = configManager.get<config.BotConfig["logging"]>("logging");
       const handLogger = loggingConfig.enabled
         ? createHandHistoryLogger(loggingConfig, { sessionId, baseDir: resultsDir })
         : null;
       ```
     - Manage lifecycle (flush on shutdown).

6.2 **Capture Hand Data**
   - Within `makeDecision` (after strategy + execution):
     - Build `HandRecord` object using:
       - `state` snapshot (maybe via new helper `serializeGameState(state)`).
       - `gto` summary (top actions + EV).
       - `agents` summary (normalized map, outputs metadata).
       - `decision` + `execution`.
       - `timing` from tracker (existing).
       - `metadata`: config snapshot hash (compute once), `rngSeed`, `modelHashes` from `StrategyEngine`.
     - Apply redaction before append based on config.
     - `await handLogger?.append(record)`.

6.3 **Hook Metrics Export**
   - Expose `handLogger?.getMetrics()` for future monitoring (Task 11/14).

6.4 **Tests**
   - Add `packages/orchestrator/test/logger/integration.spec.ts` verifying:
     - Logger receives append calls.
     - Redaction invoked when enabled.
     - Retention invoked on startup (mock fs).

### 7. CLI / Tooling

7.1 **Add Report Entry**
   - Update `report.md` summarizing Task 10 deliverables, config changes, verification commands.

7.2 **Update Progress Docs**
   - `progress.md` upcoming work section once Task 10 implemented.
   - `task10.md` (this file) kept up to date as implementation plan reference.

### 8. Documentation & Examples

8.1 **README/Design Updates**
   - `design.md` or `project_structure.md`: add section for Hand History Logger architecture.
   - Provide sample log snippet + ACPC export reference.

8.2 **Configuration Checklist**
   - Update `task9_check.md` or new `task10_check.md` with commands:
     - `ls results/hands` confirm file creation.
     - `node scripts/hand-log-verify.js <logfile>` to ensure JSON valid (optional script).

---

## Definition of Done

1. `@poker-bot/logger` implements real logging, redaction, exporters, metrics, retention with tests.
2. Shared types introduced for `HandRecord` and consumed by orchestrator/logger.
3. Config schema + defaults extended; runtime path configurable.
4. Orchestrator writes a `HandRecord` per decision (even when execution disabled).
5. JSON + ACPC exports available; metrics summaries generated.
6. Retention removes logs older than configured days.
7. All verification commands listed at top pass locally; new docs/checklists updated.

Once the above criteria are satisfied and merged, Task 10 can be declared complete and we can move on to Task 11 (Health Monitor).

