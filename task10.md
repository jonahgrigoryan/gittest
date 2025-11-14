# Task 10 – Hand History Logger

**Objective:** Build a production-ready hand history logging system that captures every decision from the orchestrator pipeline, persists the data safely, redacts sensitive fields, and produces exportable summaries + metrics with a configurable retention policy.

This picks up immediately after Task 9 (Action Executor). We now have `StrategyDecision` objects (and optional execution results) being produced in `packages/orchestrator/src/main.ts`. Task 10 wires a logging layer directly after each hand is decided/executed so downstream consumers (compliance, auditing, research) can inspect complete per-hand artifacts.

---

## Prerequisites & Dependencies

- Task 1–9 merged on `main` (all Strategy/Executor plumbing available).
- **Agent Coordinator Integration**: Task 10 requires real agent outputs for logging. Before starting Task 10, replace `createEmptyAggregatedAgentOutput()` in `packages/orchestrator/src/main.ts` (line 205-206) with actual `AgentCoordinator.query()` call. The `AgentCoordinatorService` exists in `packages/agents/src/coordinator.ts` and just needs to be instantiated and wired into `makeDecision()`. See TODO comment in main.ts.
- Packages needed: `@poker-bot/logger`, `@poker-bot/shared`, `@poker-bot/orchestrator`, `@poker-bot/executor`.
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
   - Add serialized types (JSON-safe, Maps flattened to arrays/records):
     ```ts
     // Serialized versions for JSONL persistence (no Maps)
     export interface SerializedGameState {
       handId: string;
       gameType: GameType;
       blinds: { small: number; big: number; ante?: number };
       positions: {
         hero: Position;
         button: Position;
         smallBlind: Position;
         bigBlind: Position;
       };
       players: Array<{ position: Position; stack: number; holeCards?: Card[] }>; // Map → Array
       communityCards: Card[];
       pot: number;
       street: Street;
       actionHistory: Action[];
       legalActions: Action[];
       confidence: {
         overall: number;
         perElement: Record<string, number>; // Map → Record
       };
       latency: number;
     }

     export interface SerializedStrategyDecision {
       action: Action;
       reasoning: {
         gtoRecommendation: Array<{ actionKey: ActionKey; probability: number }>; // Map → Array
         agentRecommendation: Array<{ actionKey: ActionKey; probability: number }>;
         blendedDistribution: Array<{ actionKey: ActionKey; probability: number }>;
         alpha: number;
         divergence: number;
         riskCheckPassed: boolean;
         sizingQuantized: boolean;
         fallbackReason?: string;
         panicStop?: boolean;
       };
       timing: StrategyTimingBreakdown; // Already JSON-safe
       metadata: {
         rngSeed: number;
         configHash: string; // SHA256 hash, NOT full configSnapshot
         riskSnapshotId?: string; // Reference, not full snapshot
         modelHashes?: Record<string, string>;
         preempted?: boolean;
         usedGtoOnlyFallback?: boolean;
         panicStop?: boolean;
       };
     }

     export interface SerializedAgentOutput {
       outputs: Array<{
         agentId: string;
         personaId: string;
         reasoning: string; // Keep for research, but redact PII
         action: ActionType;
         sizing?: number;
         confidence: number;
         latencyMs: number;
         tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
         costUsd?: number;
       }>;
       normalizedActions: Record<ActionType, number>; // Map → Record
       consensus: number;
       winningAction: ActionType | null;
       budgetUsedMs: number;
       circuitBreakerTripped: boolean;
       notes?: string;
       droppedAgents?: Array<{ agentId: string; reason: string }>;
       costSummary?: {
         totalTokens: number;
         promptTokens: number;
         completionTokens: number;
         totalCostUsd?: number;
       };
       startedAt: number;
       completedAt: number;
     }

     export interface HandOutcome {
       handId: string;
       netChips: number; // From RiskGuard.recordOutcome({ net })
       rake?: number;
       showdown?: boolean;
       recordedAt: number;
     }

     export interface HandRecord {
       handId: string;
       sessionId: string;
       createdAt: number;
       rawGameState: SerializedGameState;
       decision: SerializedStrategyDecision;
       execution?: ExecutionResult; // Reuse from @poker-bot/executor directly (no circular dep)
       solver?: {
         actions: Array<{ actionKey: ActionKey; frequency: number; ev?: number }>;
         exploitability: number;
         computeTime: number;
         source: 'cache' | 'subgame';
       };
       agents?: SerializedAgentOutput;
       timing: StrategyTimingBreakdown;
       outcome?: HandOutcome; // Added later when RiskGuard.recordOutcome() is called
       metadata: {
         configHash: string;
         redactionApplied: boolean;
         redactedFields?: string[]; // Audit trail of what was redacted
       };
     }

     export interface SessionMetrics {
       sessionId: string;
       handsLogged: number;
       winRateBb100: number; // Only computed when outcomes available
       evAccuracy: {
         meanDelta: number;
         p50Delta: number;
         p95Delta: number;
         p99Delta: number;
       };
       latency: {
         gto: { p50: number; p95: number; p99: number };
         agents: { p50: number; p95: number; p99: number };
         execution: { p50: number; p95: number; p99: number };
         total: { p50: number; p95: number; p99: number };
       };
       decisionQuality: {
         divergenceMean: number;
         riskFallbackCount: number;
         gtoOnlyFallbackCount: number;
       };
       computedAt: number;
     }
     ```
   - Export new interfaces via `packages/shared/src/index.ts`.

1.2 **Add Serializer Helper Functions**
   - File: `packages/shared/src/strategy.ts` (add to same file)
   - Implement serialization utilities:
     ```ts
     import { createHash } from 'node:crypto';
     import type { GameState, StrategyDecision, StrategyConfig } from './types';
     import type { AggregatedAgentOutput } from '@poker-bot/agents';
     import type { GTOSolution } from './types';

     export function serializeGameState(state: GameState): SerializedGameState {
       return {
         ...state,
         players: Array.from(state.players.entries()).map(([pos, info]) => ({
           position: pos,
           ...info
         })),
         confidence: {
           overall: state.confidence.overall,
           perElement: Object.fromEntries(state.confidence.perElement)
         }
       };
     }

     export function serializeStrategyDecision(
       decision: StrategyDecision, 
       configHash: string
     ): SerializedStrategyDecision {
       return {
         action: decision.action,
         reasoning: {
           ...decision.reasoning,
           gtoRecommendation: mapToArray(decision.reasoning.gtoRecommendation),
           agentRecommendation: mapToArray(decision.reasoning.agentRecommendation),
           blendedDistribution: mapToArray(decision.reasoning.blendedDistribution),
         },
         timing: decision.timing,
         metadata: {
           rngSeed: decision.metadata.rngSeed,
           configHash,
           riskSnapshotId: decision.metadata.riskSnapshot ? 'current' : undefined,
           modelHashes: decision.metadata.modelHashes,
           preempted: decision.metadata.preempted,
           usedGtoOnlyFallback: decision.metadata.usedGtoOnlyFallback,
           panicStop: decision.metadata.panicStop,
         }
       };
     }

     export function serializeAgentOutput(agents: AggregatedAgentOutput): SerializedAgentOutput {
       return {
         outputs: agents.outputs.map(output => ({
           agentId: output.agentId,
           personaId: output.personaId,
           reasoning: output.reasoning,
           action: output.action,
           sizing: output.sizing,
           confidence: output.confidence,
           latencyMs: output.latencyMs,
           tokenUsage: {
             promptTokens: output.tokenUsage.promptTokens,
             completionTokens: output.tokenUsage.completionTokens,
             totalTokens: output.tokenUsage.promptTokens + output.tokenUsage.completionTokens
           },
           costUsd: output.costUsd
         })),
         normalizedActions: Object.fromEntries(agents.normalizedActions) as Record<ActionType, number>,
         consensus: agents.consensus,
         winningAction: agents.winningAction,
         budgetUsedMs: agents.budgetUsedMs,
         circuitBreakerTripped: agents.circuitBreakerTripped,
         notes: agents.notes,
         droppedAgents: agents.droppedAgents?.map(f => ({ agentId: f.agentId, reason: f.reason })),
         costSummary: agents.costSummary,
         startedAt: agents.startedAt,
         completedAt: agents.completedAt
       };
     }

     export function computeConfigHash(config: StrategyConfig): string {
       const canonical = JSON.stringify(config, Object.keys(config).sort());
       return createHash('sha256').update(canonical).digest('hex');
     }

     function mapToArray(map: Map<ActionKey, number>): Array<{ actionKey: ActionKey; probability: number }> {
       return Array.from(map.entries()).map(([actionKey, probability]) => ({ actionKey, probability }));
     }
     ```
   - These helpers ensure Maps are flattened before JSON serialization and config snapshots are hashed.

### 2. Logger Package Foundations (Req 10.1–10.2)

2.1 **Implement `HandHistoryLogger`**
   - File: `packages/logger/src/hand_history.ts`
   - Responsibilities:
     - Accept constructor config: `{ sessionId, outputDir, retentionDays, flushIntervalMs, maxFileSizeMb, redactionConfig, metricsConfig, logger }`.
     - Methods: `async append(record: HandRecord): Promise<void>`, `async flush(): Promise<void>`, `async close(): Promise<void>`, `recordOutcome(handId: string, outcome: HandOutcome): Promise<void>`, `getMetrics(): SessionMetrics | null`.
     - **Persistence guarantees**:
       - `append()` must be async and await write queue flush (handles backpressure)
       - Use write queue with backpressure handling (drain events)
       - Flush timer runs every `flushIntervalMs` (default 250ms) OR after M records, whichever comes first
       - Ensure ≤1s to disk guarantee: flush on `process.on('beforeExit')` and orchestrator shutdown hook
       - Error handling: retry transient FS errors (up to 3 attempts), emit structured telemetry on failure, stop accepting records if persistence cannot be guaranteed
     - Use Node streams (`fs.createWriteStream`) with names like `${sessionPrefix}_<sessionId>_<timestamp>.jsonl` (default prefix "HH").
     - Track `lastPersistedAt` for metrics.
     - File rotation: when `maxFileSizeMb` exceeded, close current file and open new one with incremented timestamp.
     - Thread-safe: use mutex for file rotation to prevent concurrent appenders from corrupting files.

2.2 **Session Manager / Factory**
   - File: `packages/logger/src/session_manager.ts` (new)
   - Export factory function: `createHandHistoryLogger(config: LoggingConfig, options: { sessionId: string; baseDir: string; logger?: Console }): HandHistoryLogger`.
   - Responsibilities:
     - Generate `sessionId` if not provided (UUID v4 or timestamp-based)
     - Resolve `outputDir` relative to `baseDir` (create directory if missing)
     - Instantiate `HandHistoryLogger` with resolved paths
     - Call retention enforcement on startup (before first log write)
     - Return logger instance
   - **Note**: File rollover is handled by `HandHistoryLogger` itself (see 2.1), not session manager.

2.3 **Redaction Utilities (Req 10.3)**
   - File: `packages/logger/src/redaction.ts`
   - Define `RedactionConfig`:
     ```ts
     export interface RedactionConfig {
       enabled: boolean;
       fields: Array<'playerNames' | 'ids' | 'ipAddresses' | 'reasoning'>;
     }
     ```
   - Export `redactHandRecord(record: HandRecord, options: RedactionConfig): HandRecord`.
   - **Concrete fields to redact**:
     - `rawGameState.players[*].name` → replace with position label (if names exist in future)
     - `agents.outputs[*].reasoning` → scan for PII patterns (usernames, site IDs) and replace with `[REDACTED]` or remove entirely
     - `execution.metadata.windowHandle` → remove or hash
     - `execution.metadata.platform` → keep generic type, remove site-specific strings
     - Any IP addresses in notes/metadata → replace with `[REDACTED]`
   - **Redaction behavior**:
     - Recursively scan HandRecord for configured field types
     - Use deterministic substitution (seat labels, hashed identifiers)
     - Set `metadata.redactionApplied = true` only when mutations occur
     - Set `metadata.redactedFields` to array of field paths that were redacted (e.g., `['agents.outputs.0.reasoning', 'execution.metadata.windowHandle']`)
   - Add unit tests covering:
     - Replacement of all configured field types
     - Verification of `redactionApplied` flag (true only when changes made)
     - Audit trail in `redactedFields`
     - Both enabled/disabled paths

### 3. Exporters (Req 10.4)

3.1 **JSON Exporter**
   - File: `packages/logger/src/exporters/json.ts`
   - Function `exportToJson(record: HandRecord, pretty?: boolean): string`.
   - Support pretty print toggle (indent width: 2 spaces).
   - Output: single JSON object (not JSONL line).

3.2 **ACPC Exporter**
   - File: `packages/logger/src/exporters/acpc.ts`
   - Function `exportToAcpc(record: HandRecord): string`.
   - Convert `HandRecord` into ACPC hand history string format:
     - Header: game type, blinds, stacks (from `rawGameState`)
     - Action sequence: derive from `rawGameState.actionHistory` (not `rawGameState.history`)
     - Board: `rawGameState.communityCards`
     - Winner: if `outcome` present, include net chips; otherwise omit
   - **File layout**: Exporters write to `${outputDir}/${sessionId}/<format>/hand_<handId>.<ext>`
     - JSON: `${outputDir}/${sessionId}/json/hand_<handId>.json`
     - ACPC: `${outputDir}/${sessionId}/acpc/hand_<handId>.txt`
   - Add tests verifying formatting for multi-street hands (preflop → flop → turn → river).

3.3 **Exporter Registry**
   - File: `packages/logger/src/exporters/index.ts`
   - Define `type LoggingFormat = 'json' | 'acpc'`.
   - Export `getExporter(format: LoggingFormat): (record: HandRecord) => string`.
   - **Execution model**: Exporters run asynchronously after main append completes (don't await in `append()`).
   - **Error handling**: Exporter failures should log warning but not prevent core log write.
   - **Concurrency**: Exporters can run in parallel; use file system locks if writing to same directory.

### 4. Metrics Aggregation (Req 10.5)

4.1 **MetricsCollector Class**
   - File: `packages/logger/src/metrics.ts`
   - Track streaming stats:
     - **Win rate (bb/100)**: Compute only when `HandRecord.outcome` is present. Formula: `(netChips / bigBlind) / hands * 100`. Use sliding window of `windowHands` (default 200).
     - **EV accuracy**: Compare chosen action EV vs solver EV for that action. Requires solver summary with EV per action. Compute mean/P50/P95/P99 deltas.
     - **Decision quality metrics**:
       - Divergence mean (from `decision.reasoning.divergence`)
       - Risk fallback count (when `decision.metadata.panicStop === true`)
       - GTO-only fallback count (when `decision.metadata.usedGtoOnlyFallback === true`)
     - **Latency histograms**: Maintain fixed-length ring buffers (size = `windowHands`) for:
       - `gtoTime` (from `decision.timing.gtoTime`)
       - `agentTime` (from `decision.timing.agentTime`)
       - `executionTime` (from `execution.timing.totalMs` if present)
       - `totalTime` (from `decision.timing.totalTime`)
     - **Percentile calculation**: Use reservoir sampling or simple quantile function on ring buffer: `quantile(sortedValues, percentile)`.
   - Provide `getSessionMetrics(): SessionMetrics`.
   - **Data source notes**:
     - Outcomes come from `HandRecord.outcome` (populated when `riskGuard.recordOutcome()` is called, separate from decision logging)
     - Missing execution data: mark as `null` in metrics, exclude from averages
     - Redaction: metrics computed on redacted data (acceptable for research use)

4.2 **Expose Metrics Exports**
   - `HandHistoryLogger` updates metrics per `append()` call.
   - Optionally writes periodic summary file `${outputDir}/${sessionId}/session_metrics.json` (every N hands or on `close()`).
   - Expose `getMetrics()` method for runtime queries (Task 11/14 monitoring).

4.3 **Unit Tests**
   - New test file `packages/logger/test/metrics.spec.ts` verifying:
     - Streaming win-rate calculation with mocked `HandOutcome`
     - EV delta computation correctness
     - Percentile calculation (P50/P95/P99) with known input distributions
     - Ring buffer behavior (overflow, windowing)
     - Missing data handling (null outcomes, no execution)

### 5. Retention Policy (Req 10.6)

5.1 **Retention Manager**
   - File: `packages/logger/src/retention.ts`
   - Function `enforceRetention(outputDir: string, retentionDays: number, sessionPrefix: string, activeSessionId?: string): Promise<void>`.
   - **Behavior**:
     - Scan for log files matching pattern: `${sessionPrefix}_*_*.jsonl` (and exporter sidecars: `json/hand_*.json`, `acpc/hand_*.txt`)
     - Delete files older than `retentionDays` (based on file `mtime`)
     - **Safeguards**:
       - Skip files from `activeSessionId` (if provided) to avoid deleting in-progress logs
       - Use file locks or check if file is currently open before deletion
       - Log deletions with structured telemetry (file path, age, size)
     - **Scheduling**:
       - Called on startup (before first log write) via `createHandHistoryLogger()`
       - Called after file rotation (if `maxFileSizeMb` exceeded)
       - Optionally: setInterval for daily runs (configurable, default: 24 hours)
   - **Race condition handling**: Use mutex/lock file to prevent concurrent retention runs from interfering with active writes.

5.2 **Config Support**
   - Extend `config/schema/bot-config.schema.json` logging section with complete schema:
     ```json
     "logging": {
       "type": "object",
       "additionalProperties": false,
       "required": ["retentionDays", "exportFormats"],
       "properties": {
         "enabled": { "type": "boolean", "default": true },
         "outputDir": { "type": "string", "default": "../../results/hands" },
         "sessionPrefix": { "type": "string", "default": "HH" },
         "retentionDays": { "type": "integer", "minimum": 0 },
         "exportFormats": {
           "type": "array",
           "minItems": 1,
           "items": { "enum": ["json", "acpc"] }
         },
         "flushIntervalMs": { "type": "integer", "minimum": 100, "default": 250 },
         "maxFileSizeMb": { "type": "integer", "minimum": 1, "default": 50 },
         "redaction": {
           "type": "object",
           "properties": {
             "enabled": { "type": "boolean", "default": true },
             "fields": {
               "type": "array",
               "items": { "enum": ["playerNames", "ids", "ipAddresses", "reasoning"] },
               "default": ["playerNames", "ids", "ipAddresses", "reasoning"]
             }
           },
           "default": { "enabled": true, "fields": ["playerNames", "ids", "ipAddresses", "reasoning"] }
         },
         "metrics": {
           "type": "object",
           "properties": {
             "enabled": { "type": "boolean", "default": true },
             "windowHands": { "type": "integer", "minimum": 1, "default": 200 }
           },
           "default": { "enabled": true, "windowHands": 200 }
         }
       }
     }
     ```
   - Mirror defaults in `config/bot/default.bot.json`.
   - **TypeScript types**: Update `packages/shared/src/config/types.ts` to include `LoggingConfig` interface matching schema.
   - **Config hash**: Document that `configHash` is computed via SHA256 of canonicalized `StrategyConfig` JSON (see serializer helpers in 1.2).

### 6. Orchestrator Integration

6.1 **Instantiate Logger**
   - File: `packages/orchestrator/src/main.ts`
   - After config load and before `makeDecision` definition:
     ```ts
     import { createHandHistoryLogger } from '@poker-bot/logger';
     import { serializeGameState, serializeStrategyDecision, serializeAgentOutput, computeConfigHash } from '@poker-bot/shared';
     import type { HandRecord, HandOutcome } from '@poker-bot/shared';
     
     const loggingConfig = configManager.get<config.BotConfig["logging"]>("logging");
     const sessionId = process.env.SESSION_ID || `session_${Date.now()}`;
     const resultsDir = path.resolve(process.cwd(), "../../results");
     
     const handLogger = loggingConfig.enabled
       ? createHandHistoryLogger(loggingConfig, { 
           sessionId, 
           baseDir: resultsDir,
           logger: console 
         })
       : null;
     
     // Compute config hash once (reused for all records)
     const strategyConfig = configManager.get<StrategyConfig>("strategy");
     const configHash = computeConfigHash(strategyConfig);
     ```
   - **Lifecycle management**:
     - Flush on `process.on('beforeExit')`: `await handLogger?.flush()`
     - Flush on orchestrator shutdown hook (if exists)
     - Close on process termination: `await handLogger?.close()`

6.2 **Capture Hand Data**
   - Within `makeDecision` function (after strategy + execution, before return):
     ```ts
     // Build HandRecord
     const serializedState = serializeGameState(state);
     const serializedDecision = serializeStrategyDecision(decision, configHash);
     const serializedAgents = agents ? serializeAgentOutput(agents) : undefined;
     
     const solverSummary = gto ? {
       actions: Array.from(gto.actions.entries()).map(([key, entry]) => ({
         actionKey: key,
         frequency: entry.solution.frequency,
         ev: entry.solution.ev
       })),
       exploitability: gto.exploitability,
       computeTime: gto.computeTime,
       source: gto.source
     } : undefined;
     
     const handRecord: HandRecord = {
       handId: state.handId,
       sessionId,
       createdAt: Date.now(),
       rawGameState: serializedState,
       decision: serializedDecision,
       execution: executionResult,
       solver: solverSummary,
       agents: serializedAgents,
       timing: decision.timing,
       metadata: {
         configHash,
         redactionApplied: false // Will be set by logger if redaction enabled
       }
     };
     
     // Append to logger (logger applies redaction internally)
     await handLogger?.append(handRecord);
     ```
   - **Note**: Redaction is applied inside `HandHistoryLogger.append()` based on config, not in orchestrator.

6.3 **Record Hand Outcomes**
   - Hook into `riskController.recordOutcome()` calls (or create wrapper):
     ```ts
     // In orchestrator return object, wrap recordOutcome:
     recordOutcome: (update: { net: number; hands?: number }) => {
       const snapshot = riskGuard.recordOutcome(update);
       
       // Log outcome to hand history logger
       if (handLogger && update.net !== undefined) {
         const outcome: HandOutcome = {
           handId: riskGuard.currentHandId || 'unknown',
           netChips: update.net,
           recordedAt: Date.now()
         };
         handLogger.recordOutcome(outcome.handId, outcome).catch(err => {
           console.warn('Failed to log hand outcome', err);
         });
       }
       
       void riskStateStore.save(snapshot);
       return snapshot;
     }
     ```
   - This enables metrics to compute win rates when outcomes are available.

6.4 **Hook Metrics Export**
   - Expose `handLogger?.getMetrics()` for future monitoring (Task 11/14).
   - Optionally: write metrics summary file periodically or on shutdown.

6.5 **Tests**
   - Add `packages/orchestrator/test/logger/integration.spec.ts` verifying:
     - Logger receives append calls with correct HandRecord structure
     - Redaction invoked when enabled (check `redactionApplied` flag)
     - Retention invoked on startup (mock fs, verify file deletion)
     - Outcome logging works when `recordOutcome()` is called
     - Metrics updated after append calls
     - Logger handles errors gracefully (doesn't crash orchestrator)

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
   - Create new `task10_check.md` with acceptance checklist:
     - [ ] Logger package builds and tests pass
     - [ ] Log files created in configured `outputDir` with correct naming pattern
     - [ ] JSONL files contain valid JSON (one record per line)
     - [ ] Redaction removes configured fields when enabled
     - [ ] Exporters generate JSON/ACPC files in correct subdirectories
     - [ ] Metrics computed correctly (win rate, latencies, EV deltas)
     - [ ] Retention deletes old files while preserving active session
     - [ ] Orchestrator integration test passes
     - [ ] Config schema validates correctly
     - [ ] Hand outcomes logged when `recordOutcome()` called
     - [ ] Logger flushes on shutdown
     - [ ] No data loss under concurrent appends

---

## Definition of Done

1. **Shared Types & Serialization**:
   - `SerializedGameState`, `SerializedStrategyDecision`, `SerializedAgentOutput`, `HandRecord`, `HandOutcome`, `SessionMetrics` defined in `@poker-bot/shared`
   - Serializer helper functions (`serializeGameState`, `serializeStrategyDecision`, `serializeAgentOutput`, `computeConfigHash`) implemented and tested
   - All Maps flattened to arrays/records for JSON serialization

2. **Logger Package**:
   - `HandHistoryLogger` implements async `append()`, `flush()`, `close()`, `recordOutcome()`, `getMetrics()`
   - Persistence guarantees: ≤1s to disk, handles backpressure, retries transient errors
   - File rotation with mutex protection when `maxFileSizeMb` exceeded
   - Redaction removes configured PII fields and sets audit trail
   - Exporters (JSON, ACPC) write to correct subdirectories asynchronously
   - Metrics collector computes win rate, EV accuracy, latency percentiles with ring buffers
   - Retention manager deletes old files while preserving active session

3. **Config & Schema**:
   - Complete `logging` schema in `bot-config.schema.json` with all properties
   - Defaults mirrored in `default.bot.json`
   - TypeScript `LoggingConfig` type added to `@poker-bot/shared/config`

4. **Orchestrator Integration**:
   - Logger instantiated via `createHandHistoryLogger()` factory
   - `HandRecord` built using serializer helpers in `makeDecision()`
   - Redaction applied automatically by logger based on config
   - Hand outcomes logged when `riskGuard.recordOutcome()` called
   - Lifecycle: flush on `beforeExit`, close on termination

5. **Testing & Verification**:
   - Unit tests for serializers, logger, redaction, exporters, metrics, retention
   - Integration test in orchestrator verifying logger receives correct data
   - All verification commands pass: `pnpm --filter "@poker-bot/logger" lint|test|build`
   - `task10_check.md` checklist completed

6. **Documentation**:
   - `task10.md` kept as implementation reference
   - `report.md` updated with Task 10 deliverables
   - `progress.md` updated

**Prerequisite Note**: Agent Coordinator must be integrated into orchestrator before Task 10 (replace `createEmptyAggregatedAgentOutput()` stub with real `AgentCoordinator.query()` call).

Once the above criteria are satisfied and merged, Task 10 can be declared complete and we can move on to Task 11 (Health Monitor).

