# Task 13 – Replay Harness & Evaluation Prep

**Objective:** Deliver a deterministic replay CLI/harness that consumes logged `HandRecord`s, replays decisions with the exact RNG seed + model versions recorded in Task 12, validates outputs, and produces batch metrics for evaluation prep (Req. 9.x, Req. 10.3, Checkpoints 14–17).

The steps below must be followed in order; each section references the exact files, interfaces, and verification commands needed for implementation.

---

## Step 1 – Shared Replay Types

**File:** `packages/shared/src/replay.ts` (new)

1. Import `Action`, `ActionKey`, `SerializedStrategyDecision`, `StrategyDecision`, `StrategyTimingBreakdown`, `ModelVersions`, `SerializedProbabilityEntry`.
2. Define:
   - `ReplayComparison` with fields:
     - `handId`, `sessionId`, `match: boolean`.
     - `differences` object (optional keys):
       - `action?: { original: Action; replayed: Action }`
       - `rngSeed?: { original: number; replayed: number }`
       - `blendedDistribution?: { original: SerializedProbabilityEntry[]; replayed: SerializedProbabilityEntry[]; divergence: number }`
       - `timing?: { original: StrategyTimingBreakdown; replayed: StrategyTimingBreakdown; delta: Partial<StrategyTimingBreakdown> }`
       - `modelVersions?: { logged: ModelVersions | undefined; current: ModelVersions | undefined; mismatches: string[] }`
     - `warnings: string[]`.
   - `ReplayResult` with `handId`, `sessionId`, `success`, optional `error`, optional `comparison`, `originalDecision`, `replayedDecision`, `timing` (`replayMs`, `originalTotalMs`, `replayedTotalMs`).
   - `BatchReplayReport` with `sessionId`, totals (`totalHands`, `successful`, `failed`, `matches`, `mismatches`), `errors`, `comparisons`, `summary` (action match rate, avg/p95 divergence, timing deltas per component), `modelVersionWarnings`.
3. Export via `packages/shared/src/index.ts`.

---

## Step 2 – HandRecord Reader Utilities

**File:** `packages/orchestrator/src/replay/reader.ts`

1. Define `ReadHandRecordsOptions` (`sessionDir?`, `handId?`, `limit?`, `offset?`).
2. Implement `async function* readHandRecords(filePath, options)`:
   - Stream JSONL via `createReadStream` + `readline.createInterface`.
   - Parse each line into `HandRecord` (wrap `JSON.parse` in try/catch; `console.warn` on malformed lines).
   - Apply `handId`, `offset`, `limit`.
3. Implement `findHandRecordFile(sessionId, resultsDir, sessionPrefix?)`:
   - Use configured `logging.sessionPrefix` when provided; otherwise scan subdirectories under `resultsDir` for `*_${sessionId}`.
   - Return first `.jsonl` path or `null`.

---

## Step 3 – Game State Deserializer

**File:** `packages/orchestrator/src/replay/deserialize.ts`

1. `deserializeGameState(serialized: SerializedGameState): GameState`:
   - Convert `players` array to `Map<Position, PlayerState>` (matching `vision/parser.ts` output).
   - Convert `confidence.perElement` back to a `Map<string, number>`.
   - Keep `legalActions` as `Action[]` (StrategyEngine expects array, not Map).
   - Restore all scalar fields (`handId`, `positions`, `communityCards`, `actionHistory`, `latency`, etc.).
2. Vitest round-trip: serialize → deserialize → compare (ensures parity with `serializeGameState` per Checkpoint 14).

---

## Step 4 – Extract Decision Pipeline

**Files:** `packages/orchestrator/src/decision/pipeline.ts` (new) and `packages/orchestrator/src/main.ts` (updated)

1. Create `DecisionPipelineDependencies` with `gtoSolver`, optional `agentCoordinator`, `strategyEngine`, optional `tracker`, optional `logger`.
2. Implement `makeDecision(state, sessionId, deps)`:
   - Reserve/compute GTO budget via `TimeBudgetTracker` (default 400 ms fallback) and call `deps.gtoSolver.solve`.
   - Obtain agent output:
     - If `deps.agentCoordinator` provided, call `query`.
     - Otherwise reuse the current stub (empty normalized map) so behavior matches `main.ts`.
   - Call `deps.strategyEngine.decide(state, gtoResult, agents, sessionId)` and return the decision (no logging/execution).
3. Update `main.ts`:
   - Replace inline decision logic with wrapper that builds dependencies and calls `decision/pipeline.makeDecision`.
   - Preserve health metrics, hand logging, execution, safe/safe-mode gating, etc.

---

## Step 5 – Model Version Validator

**File:** `packages/orchestrator/src/replay/model_validator.ts`

1. Define `ModelVersionMismatch` (`component`, `agentId?`, `field`, `logged`, `current`).
2. Implement `ModelVersionValidator` class:
   - Constructor accepts `ModelVersionCollector`, optional `strict`, optional `logger`.
   - `validate(logged: ModelVersions | undefined)`:
     - Fetch current versions via collector.
     - Compare LLM entries (`modelId`, `weightsHash`, `version`).
     - Compare vision (`modelFiles` sorted, per-file `versions`, `modelDir`).
     - Compare GTO cache (`manifestVersion`, `fingerprintAlgorithm`, `cachePath`).
     - Return `{ matches, mismatches, warnings, currentVersions }`; throw or flag errors when `strict` is enabled.
3. Add unit tests covering match/mismatch scenarios.

---

## Step 6 – Replay Engine Core

**File:** `packages/orchestrator/src/replay/engine.ts`

1. Define `ReplayEngineDeps` (`configManager`, `gtoSolver`, `strategyEngine`, optional `agentCoordinator`, optional `trackerFactory`, `modelVersionValidator`, optional `logger`).
2. Implement `ReplayEngine`:
   - `async replayHand(record: HandRecord): Promise<ReplayResult>`:
     1. Deserialize `rawGameState`.
     2. Validate model versions (capture mismatches/warnings).
     3. Create tracker (if provided) per hand.
     4. Call extracted decision pipeline (`makeDecision`) with `sessionId`.
     5. Convert original/replayed distributions to Maps, compute divergence via `DivergenceDetector`.
     6. Compare action, RNG seed, timing, metadata; build `ReplayComparison`.
   - `async replayBatch(filePath, options, strictVersions): Promise<BatchReplayReport>`:
     - Iterate via `readHandRecords`.
     - Aggregate `matches`, `mismatches`, divergence stats (mean/p95), timing deltas, warnings, errors.
3. Add vitest suite with synthetic HandRecords covering success and mismatch cases.

---

## Step 7 – Replay CLI

**File:** `packages/orchestrator/src/cli/replay.ts` (or equivalent CLI entry)

1. CLI options:
   - `--sessionId <id>` or `--file <path>` (one required).
   - `--handId <id>`, `--limit`, `--offset`.
   - `--resultsDir <path>` (default `../../results/hands`).
   - `--strict-versions`.
   - `--output <path>` for JSON report.
2. Behavior:
   - Initialize `ConfigurationManager` (reuse orchestrator config loading).
   - Instantiate dependencies mirroring `main.ts`:
     - `CacheLoader` + `GTOSolver`.
     - `RiskGuard` (or stub `RiskGuardAPI` that always allows) so `StrategyEngine` can be constructed exactly as in production.
     - `StrategyEngine` using the risk controller above plus extracted pipeline deps.
     - `TimeBudgetTracker` factory for per-hand trackers.
     - `ModelVersionCollector` (using `configManager` + layout/cache paths, no vision client needed) and `ModelVersionValidator`.
   - Resolve HandRecord path via `findHandRecordFile`.
   - Invoke `ReplayEngine.replayBatch`.
   - Print summary to stdout; write `BatchReplayReport` when `--output` provided.
3. Wire CLI into `packages/orchestrator/package.json` (e.g., `"replay": "node dist/cli/replay.js"`).
4. Document usage in `docs/replay.md`.

---

## Step 8 – Documentation & Checklists

1. Update `docs/replay.md` with CLI instructions, sample usage, sample output, explanation of mismatches and warnings.
2. Create/Update `task13_check.md` listing acceptance criteria (seed match, model-version validation, CLI runs).
3. Update `progress.md` (Task 13 entry) and `report.md` (summary section).
4. Update `tasks.md` / `requirements.md` as necessary to mark Req 9.x/10.3 coverage.

---

## Step 9 – Verification & Manual Smokes

1. `pnpm --filter "@poker-bot/shared" test`
2. `pnpm --filter "@poker-bot/orchestrator" lint`
3. `pnpm --filter "@poker-bot/orchestrator" test`
4. `pnpm --filter "@poker-bot/orchestrator" build`
5. CLI manual checks:
   - `pnpm replay --sessionId <session>` (expect match summary).
   - `pnpm replay --sessionId <session> --strict-versions` (expect failure when versions differ).
   - Optional: `pnpm replay --file <path> --handId <id> --limit 1`.

Record these runs in the PR description and tick off `task13_check.md`.

---

**Notes/Risks**
- Until the real agent coordinator is wired into orchestrator, the replay pipeline should default to the same stub agent output to avoid false mismatches. Clearly comment where the coordinator would be injected once available.
- Ensure `findHandRecordFile` respects custom `logging.sessionPrefix`.
- Use streaming readers to handle large JSONL logs; expose `--limit` for quick samples.
- Replay should honor the 2 s SLA (per Checkpoint 17). Include timing deltas in reports so regressions surface early.
