# Task 7: Risk Guard — Detailed Implementation Plan

## Current State Assessment

- Safety config already exposes `bankrollLimit`, `sessionLimit`, and panic-stop thresholds in `config/bot/*.bot.json` and `config/schema/bot-config.schema.json`, but nothing in `packages/orchestrator` consumes those values yet.
- The orchestrator exports SafeAction helpers (`packages/orchestrator/src/safety/safe-action.ts`) and the new `TimeBudgetTracker`, yet there is no module dedicated to risk or bankroll management, and no runtime state survives between hands.
- Strategy decisions currently stop at GTO solving (Task 4) and agent coordination (Task 5) with budgeting (Task 6); there is no `RiskGuard` to gate decisions, emit panic-stop signals, or track bankroll/session exposure.
- Tests only assert SafeAction and budget behavior; there are no unit tests covering safety limits, panic-stop triggers, or remaining-hand calculations.

## Goals & Scope

- Implement a production-ready `RiskGuard` inside the orchestrator that enforces bankroll/session limits before an action is finalized, per Requirement 10.4 and Tasks 7.1–7.2.
- Track live exposure per hand, cumulative bankroll delta, and hands played across the session; expose structured snapshots so downstream components (Strategy Engine, Logger, future SafeMode handler) can consume consistent data.
- Provide deterministic panic-stop signaling (latching flag + metadata) so the orchestrator can halt play and force SafeAction once a limit is hit.
- Ship comprehensive unit tests that mimic realistic scenarios (calls, raises, hot-reload of limits) using Vitest under `packages/orchestrator`.

_Out of scope_: Strategy blending (Task 8), executor halting (Task 11), and UI/telemetry surfaces that consume panic-stop events. Those hooks will land later but must be unblocked by the APIs introduced here.

## Requirements Mapping

- **Requirement 10.4** → Enforce configurable bankroll + session limits, expose remaining values, and trigger panic stop when exceeded.
- **Requirement 10.6 / SafeAction** → RiskGuard must hand enough context to Strategy Engine so it can fall back to SafeAction immediately upon violation.
- **Checkpoint 9** (checkpoints.md) → Validations and test cases listed there become the acceptance bar for this task.

## Architecture & Interfaces

- Add `packages/orchestrator/src/safety/riskGuard.ts` implementing:
  - `interface RiskGuardOptions { logger?: Pick<Console, "info" | "warn" | "error">; now?: () => number; onPanicStop?: (event: PanicStopEvent) => void; }`
  - `interface RiskLimits { bankrollLimit: number; sessionLimit: number; currentBankroll: number; currentSessionHands: number; }` (matches `design.md §7` contract so sessions resume with non-zero exposure).
  - `interface RiskSnapshot { netProfit: number; drawdown: number; handsPlayed: number; remainingHands: number; remainingBankroll: number; liveExposure: number; panicStop: boolean; panicReason?: RiskViolation; updatedAt: number; }`
  - `interface RiskCheckResult { allowed: boolean; reason?: RiskViolation; snapshot: RiskSnapshot; }`
  - `interface PanicStopEvent { triggeredAt: number; handId?: string; reason: RiskViolation; snapshot: RiskSnapshot; }` stored in `packages/orchestrator/src/safety/types.ts`.
  - `type RiskViolation = { type: "bankroll" | "session"; threshold: number; observed: number; handId?: string; pendingExposure?: number; }`.
- Persisted values:
  - `currentBankroll` equals cumulative net profit (wins minus losses) relative to the configured bankroll start; defaults to 0 when no previous session file exists.
  - `currentSessionHands` is a running count of hands the session has played; also defaults to 0 on first launch.
- Core responsibilities:
  1. _State_: Track cumulative bankroll delta (`netProfit`), drawdown (`max(0, -netProfit)`), live exposure in the current hand, and session hand count.
  2. _Limit evaluation_: `checkLimits(action, state, options?: { handId?: string; commit?: boolean; dryRun?: boolean })` computes incremental commitment for the action using hero contribution logic (mirrors `computeLegalActions`), adds live exposure, compares against `bankrollLimit`, then checks session remaining hands. It returns a `RiskCheckResult` and, when `commit` is true (default), updates live exposure to ensure future checks are cumulative.
  3. _Lifecycle_: `startHand(handId)` resets per-hand exposure & panic flags for the new hand; `recordOutcome({ net, handsPlayed?: 1 })` updates bankroll after a hand resolves; `incrementHandCount()` increments session counters for cases where decisions progress without `recordOutcome`.
  4. _Panic stop_: Once a violation occurs, latch `panicStop=true`, populate `panicReason`, invoke `options.onPanicStop`, and keep rejecting further actions until `resetPanicStop()` or `resetSession()` is called.
  5. _Hot reload_: `updateLimits(newLimits)` applies config changes without losing historical state by clamping live exposure to the new limit if needed and re-evaluating panic status.
- Exposure math helpers (local functions inside `riskGuard.ts`):
  - `getHeroContribution(state)`: reuse logic from `vision/legal-actions.ts` (duplicate or refactor helper into shared safety util) to compute amount already invested.
  - `calculateIncrementalCommitment(action, state)`: 
    - fold/check → 0
    - call → `action.amount ?? getCallAmount(state)` (protect against undefined)
    - raise → `Math.max(0, (action.amount ?? 0) - heroContribution)`
  - Ensure we cap incremental commitment at hero stack size to prevent negative remaining stack calculations.

## Step-by-step Plan

### 7.1 Risk Limit Enforcement

1. **Safety types + exports**
   - Create `packages/orchestrator/src/safety/types.ts` (if needed) to host `RiskLimits`, `RiskSnapshot`, `RiskViolation`, `RiskCheckResult`, `PanicStopEvent`, and `RiskGuardOptions`.
   - Re-export these types (and the upcoming `RiskGuard`) from `packages/orchestrator/src/index.ts` for downstream packages (Strategy Engine, tests, future executor).
   - Update `project_structure.md` (Safety section) to mention the new `riskGuard.ts`.

2. **Implement `RiskGuard`**
   - File: `packages/orchestrator/src/safety/riskGuard.ts`.
   - Constructor accepts `limits: RiskLimits` (seeding `netProfit` from `limits.currentBankroll`, `handsPlayed` from `limits.currentSessionHands`), and optional logger/hooks; `config` is no longer needed once limits are provided explicitly.
   - Internal state:
     ```ts
     private handsPlayed = limits.currentSessionHands;
     private netProfit = limits.currentBankroll;
     private liveExposure = 0;
     private panicStop = false;
     private panicReason?: RiskViolation;
     ```
   - Public API:
     - `startHand(handId: string, opts?: { carryExposure?: number }): void` — resets `liveExposure`, stores `currentHandId`, applies carried exposure (e.g., forced blinds already posted), and clears panic flag unless still over limit.
     - `incrementHandCount(): number` — increments `handsPlayed`, returns remaining hands.
     - `recordOutcome(result: { net: number; hands?: number }): RiskSnapshot` — updates `netProfit`/`currentBankroll`, subtracts live exposure (hand resolved), increments hand count when `hands` provided, persists via store helper, and refreshes snapshot.
     - `updateLimits(limits: Partial<RiskLimits>): RiskSnapshot` — merges new limits, recomputes `panicStop` if the existing drawdown already exceeds tightened caps.
     - `resetSession()` — zeroes everything (used by operator or tests).
     - `getSnapshot(): RiskSnapshot` — returns immutable view for telemetry/logging.
     - `checkLimits(action: Action, state: GameState, opts?: { handId?: string; commit?: boolean; dryRun?: boolean }): RiskCheckResult`.
       - Determine incremental commitment via helper.
       - Evaluate bankroll: `projectedDrawdown = drawdown + liveExposure + incremental`, compare to `bankrollLimit` (ignore if 0).
       - Evaluate session: if `sessionLimit > 0 && handsPlayed >= sessionLimit`, treat as violation even before action.
       - Compose `RiskCheckResult`.
       - When violation occurs, set panic flag, save reason, call `logger?.warn` + `onPanicStop`.
       - On pass and `commit !== false`, add incremental to `liveExposure`.
       - Always include updated `snapshot`.
   - Provide helper `shouldEnforce(limit: number): boolean => limit > 0`.
   - Guard against NaN inputs; clamp to `0`.

3. **Commitment + lifecycle helpers**
   - Avoid code duplication by moving hero contribution math into shared utility (either export from `vision/legal-actions.ts` or recreate simplified helper inside `riskGuard.ts` with unit tests).
   - Add `calculateRemainingBankroll()` returning `Math.max(0, bankrollLimit - drawdown - liveExposure)` for snapshot.
   - Snapshot fields should always be non-negative and time-stamped using `options.now?.() ?? Date.now()`.

4. **Persistence + integration wiring**
   - Build `packages/orchestrator/src/safety/riskStateStore.ts` with APIs:
     ```ts
     interface RiskState { currentBankroll: number; currentSessionHands: number; }
     class RiskStateStore {
       constructor(path: string, fsImpl = fs/promises) { ... }
       load(): Promise<RiskState>;
       save(snapshot: RiskSnapshot): Promise<void>;
     }
     ```
     so RiskGuard resumes from the persisted bankroll/session counts (defaults to zeros when file missing).
   - Update `packages/orchestrator/src/index.ts` to export `RiskGuard` + related types and the `RiskStateStore` helper.
   - In `packages/orchestrator/src/main.ts`:
     - Resolve `riskStateStorePath` (env override `RISK_STATE_PATH` or `logs/session/risk-state.json`), `await fs.promises.mkdir(path.dirname(riskStateStorePath), { recursive: true })`, instantiate `RiskStateStore`, and `await store.load()` before creating RiskGuard.
     - Compute `const riskLimits: RiskLimits = { bankrollLimit: safety.bankrollLimit, sessionLimit: safety.sessionLimit, currentBankroll: state.currentBankroll, currentSessionHands: state.currentSessionHands };`.
     - Instantiate `const riskGuard = new RiskGuard(riskLimits, { logger: console, onPanicStop: emitPanicStop });`.
     - Subscribe to configuration updates via the existing API: `configManager.subscribe("safety", (safetyCfg) => riskGuard.updateLimits({ bankrollLimit: safetyCfg.bankrollLimit, sessionLimit: safetyCfg.sessionLimit }));`.
     - Expose `risk` object via `run()` return value with methods `startHand`, `recordOutcome`, `incrementHandCount`, `checkLimits`, `snapshot`, so the upcoming Strategy Engine (Task 8) and executor modules can call into it without re-instantiating.
     - When a new `GameState` arrives from the parser, call `risk.startHand(state.handId)` **and immediately** `risk.incrementHandCount()` to advance the session counter before running solver/agents; when the hand ends (either via actual result callback or manual override), call `risk.recordOutcome({ net: delta })` and `await riskStateStore.save(risk.snapshot())` so persistence stays in sync.
     - Provide a utility `function enforceRiskOrSafeAction(action: Action, state: GameState): RiskCheckResult` (wrapper over `risk.checkLimits`) that Strategy Engine will invoke before finalizing any action in Task 8. Document this contract in `design.md §7` and in `tasks.md §8.4` so the enforcement step is mandatory once action selection exists.
     - Define `function emitPanicStop(event: PanicStopEvent) { logger.warn(...); riskStateStore.save(event.snapshot).catch(console.error); }` so telemetry + persistence happen synchronously whenever panic stop fires.
   - Ensure snapshots persist after every `recordOutcome` and whenever panic stop triggers (call `riskStateStore.save(riskGuard.getSnapshot())`).
   - Document this wiring in `design.md §7` so the architecture spec matches reality.

5. **Docs**
   - Create `task7.md` (this file) and link from `progress.md` after completion.
   - Update `checkpoints.md` Checkpoint 9 notes if any clarifications needed (optional but recommended).

### 7.2 Unit Tests for RiskGuard

1. **Test scaffolding**
   - New file: `packages/orchestrator/test/safety/riskGuard.spec.ts`.
   - Reuse `createBotConfig` + `createParsedState` helpers from `test/utils/factories.ts` to build `GameState`.
   - Mock logger via `const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }`.

2. **Test cases**
   - _Allows zero-limit configs_: instantiate with both limits set to 0, verify `checkLimits` always passes and snapshot stays stable.
   - _Blocks bankroll breach_: set bankrollLimit=1000, simulate cumulative loss 950 via `recordOutcome({ net: -950 })`, then attempt action needing 100 — expect `allowed=false`, panicStop latched, exposure unchanged.
   - _Accounts for live exposure_: commit 400 chips through successive raises (check `checkLimits` with commit), ensure guard rejects another 700 if remaining bankroll < 700 even though bankroll delta hasn’t materialized yet.
   - _Session limit enforcement_: set sessionLimit=3, call `incrementHandCount()` thrice, confirm fourth `checkLimits` fails with `type: "session"`.
   - _Reset + update_: after panic stop, call `resetSession()` and ensure guard allows actions; tighten limits via `updateLimits({ bankrollLimit: 500 })` and confirm snapshots reflect new remaining amount.
   - _Hero contribution math_: verify incremental commitment for raise subtracts previous contribution and does not exceed hero stack.
   - _Panic-stop hook_: pass `onPanicStop` spy and ensure it fires once per breach with metadata.

3. **Test commands**
   - `pnpm --filter "@poker-bot/orchestrator" run lint`
   - `pnpm --filter "@poker-bot/orchestrator" run test -- riskGuard`
   - Include these commands in the Verification Checklist section below.

## Telemetry & Config

- Log structure when a violation occurs:
  ```ts
  logger?.warn("RiskGuard: panic stop triggered", {
    reason: panicReason.type,
    observed: panicReason.observed,
    threshold: panicReason.threshold,
    handId: panicReason.handId,
    remainingBankroll: snapshot.remainingBankroll,
    remainingHands: snapshot.remainingHands
  });
  ```
- Emit `onPanicStop` callback with `PanicStopEvent` payload so Strategy Engine (Task 8) or SafeMode (Task 11) can propagate to the executor/logging pipelines.
- Config reload: `ConfigurationManager` already broadcasts updates; RiskGuard’s consumer will call `riskGuard.updateLimits(newSafetyConfig)` whenever safety config changes.

## Verification Checklist

- [ ] `pnpm --filter "@poker-bot/orchestrator" run lint`
- [ ] `pnpm --filter "@poker-bot/orchestrator" run test -- riskGuard`
- [ ] `pnpm -r --filter "./packages/**" run build` (to ensure type exports don’t break other packages)
- [ ] Checkpoint 9 validation: manual review of panic-stop logs + snapshot correctness.

## Risks & Mitigations

- **Incorrect exposure math** → Mirror logic from `vision/legal-actions`, add targeted unit tests for call vs raise vs stack-cap scenarios.
- **Config reload drift** → Provide `updateLimits` that clamps state and emits warnings if the new limit is already violated, so operators know to reset session.
- **Panic-stop latch never cleared** → Expose explicit `resetSession` / `resetPanicStop` APIs and document usage in Task 8 plan so Strategy Engine can recover only when operator approves.
- **Telemetry gaps** → Always include `handId` in `RiskViolation` (when provided) and stamp snapshots with `updatedAt` for downstream audit trails.
