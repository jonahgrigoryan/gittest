# Agent Zero (for holistic review and testing) Codebase Review Guide

## Overview

This document provides Agent Zero (for holistic review and testing) with comprehensive information to review, test, and fix issues in the poker bot codebase.

**⚠️ Important: Holistic Review Approach**

Agent Zero (for holistic review and testing) should analyze the **entire bot as a whole** rather than reviewing each individual task separately. The codebase represents a merged, integrated system where all components work together. Focus on:
- **Integration issues** between modules that may not have been caught during individual task development
- **End-to-end functionality** of the complete bot system
- **Cross-module interactions** and how components interact in production scenarios
- **System-wide problems** that emerge when all tasks are integrated together

## Codebase Structure

### Monorepo Architecture
- **Package Manager**: pnpm workspaces
- **TypeScript**: All packages use TypeScript with strict type checking
- **Root**: `/Users/jonahgrigoryan/gittest`

### Core Packages

1. **`@poker-bot/agents`** (`packages/agents/`)
   - Multi-LLM reasoning layer
   - Personas: GTO Purist, Exploitative Aggressor, Risk-Averse Value
   - Coordinator, weighting engine, schema validation
   - **Key Files**: `src/coordinator.ts`, `src/personas/`, `src/weighting/`

2. **`@poker-bot/orchestrator`** (`packages/orchestrator/`)
   - Main decision-making pipeline
   - Integrates vision, GTO solver, agents, strategy engine
   - **Key Files**: `src/main.ts`, `src/decision/pipeline.ts`, `src/strategy/engine.ts`

3. **`@poker-bot/shared`** (`packages/shared/`)
   - Shared types, utilities, configuration
   - Game state definitions, action types
   - **Key Files**: `src/types.ts`, `src/config.ts`

4. **`@poker-bot/logger`** (`packages/logger/`)
   - Hand history logging
   - Structured logging with redaction
   - **Key Files**: `src/handHistory.ts`

5. **`@poker-bot/executor`** (`packages/executor/`)
   - Action execution (simulator/API)
   - Action verification
   - **Key Files**: `src/executor.ts`

6. **`@poker-bot/evaluator`** (`packages/evaluator/`)
   - Testing and evaluation framework
   - Smoke tests, AB testing
   - **Key Files**: `src/evaluator.ts`

### Services (Rust/Python)

1. **`services/solver/`** (Rust)
   - GTO solver implementation
   - Cached solutions
   - **Key Files**: `src/solver.rs`

2. **`services/vision/`** (Python)
   - Computer vision for game state parsing
   - Layout packs, ROI detection
   - **Key Files**: `src/vision.py`

## Testing Strategy

**Focus on Integration Testing**

Since this is a merged main branch with all tasks integrated, testing should emphasize:
- **End-to-end workflows** that span multiple packages
- **Integration points** between modules (orchestrator ↔ agents ↔ solver ↔ executor)
- **Cross-package interactions** that may not be covered by unit tests
- **Functional behavior** of the complete bot system
- **Runtime integration issues** that only appear when all components work together

### 1. Build All Packages
```bash
# Build everything
pnpm run build

# Build specific package
pnpm --filter "@poker-bot/agents" run build
pnpm --filter "@poker-bot/orchestrator" run build
pnpm --filter "@poker-bot/shared" run build
pnpm --filter "@poker-bot/logger" run build
pnpm --filter "@poker-bot/executor" run build
pnpm --filter "@poker-bot/evaluator" run build
```

### 2. Run Tests
```bash
# Run all tests
pnpm run test

# Run tests for specific package
pnpm --filter "@poker-bot/agents" run test
pnpm --filter "@poker-bot/orchestrator" run test
pnpm --filter "@poker-bot/shared" run test
pnpm --filter "@poker-bot/logger" run test
pnpm --filter "@poker-bot/executor" run test
pnpm --filter "@poker-bot/evaluator" run test
```

### 3. Type Checking
```bash
# Type check all packages
pnpm run typecheck

# Type check specific package
pnpm --filter "@poker-bot/agents" run typecheck
```

### 4. Linting
```bash
# Lint all packages
pnpm run lint

# Lint specific package
pnpm --filter "@poker-bot/agents" run lint
```

### 5. CI Verification
```bash
# Run full test validation
pnpm run ci:verify
```

### 6. Environment Validation
```bash
# Validate environment setup
Ensure environment variables are properly set, especially for external services like GTO solver and vision service
```

## Log Locations

### Application Logs
- **Session Logs**: `results/session/health-*.jsonl`
- **Hand History**: `results/hands/session_*/`
- **Replay Reports**: `results/replay/report.json`

### Test Outputs
- **Test Results**: Check console output from `pnpm run test`
- **Coverage**: May be in `coverage/` directories (if configured)

### Build Artifacts
- **Dist Folders**: `packages/*/dist/`
- **Type Definitions**: `packages/*/dist/*.d.ts`

## Common Issues to Look For

### 1. Type Errors
- Check for TypeScript compilation errors
- Look for `any` types that should be properly typed
- Missing type definitions

### 2. Runtime Errors
- Check logs for runtime exceptions
- Look for unhandled promise rejections
- Memory leaks or resource issues

### 3. Integration Issues (High Priority)
- **Cross-module communication failures** (e.g., orchestrator → agents → strategy engine)
- **Data flow problems** between packages (type mismatches, serialization issues)
- **Configuration inconsistencies** across modules
- **Runtime integration failures** not caught by unit tests
- **Module interaction bugs** (e.g., agent output not properly consumed by strategy engine)
- **End-to-end workflow breaks** (vision → parser → decision → execution)
- Package dependencies not resolving
- Configuration loading failures
- Missing environment variables

### 4. Test Failures
- Flaky tests
- Tests that should pass but don't
- Missing test coverage

### 5. Performance Issues
- Slow builds
- Memory usage spikes
- Timeout issues in tests

### 6. Configuration Issues
- Invalid config schema
- Missing required config values
- Config not loading properly

## Key Configuration Files

1. **`config/bot/default.bot.json`** - Main bot configuration
2. **`package.json`** - Root package.json with scripts
3. **`pnpm-workspace.yaml`** - Workspace configuration
4. **`tsconfig.base.json`** - Base TypeScript config
5. **`packages/*/tsconfig.json`** - Package-specific TS configs

## Environment Variables

Check `docs/env.md` for required environment variables. Common ones:
- API keys for LLM providers
- Database connections
- Service URLs

## Debugging Commands

```bash
# Check for uncommitted changes
git status

# View recent commits
git log --oneline -10

# Check package versions
pnpm list --depth=0

# Check for outdated packages
pnpm outdated

# Clear build artifacts
pnpm run clean

# Rebuild from scratch
pnpm run clean && pnpm run build
```

## Fix Workflow

1. **Identify Issue**: Review logs, test failures, or code inspection
2. **Create Test Case**: If possible, write a test that reproduces the issue
3. **Implement Fix**: Make minimal changes to fix the issue
4. **Verify Fix**: Run tests and build to ensure fix works
5. **Document**: Update this file or create issue notes

## Agent Zero (for holistic review and testing) Instructions

**Review Approach: Bot-Wide Integration Focus**

1. **Start with Build**: Run `pnpm run build` and note any errors
2. **Run Integration Tests**: Execute `pnpm run test` focusing on cross-module tests
3. **Run End-to-End Tests**: Test complete workflows (vision → decision → execution)
4. **Check Logs**: Review logs in `results/` directory for integration failures
5. **Type Check**: Run `pnpm run typecheck` for type errors, especially at module boundaries
6. **Lint**: Run `pnpm run lint` for code quality issues
7. **Review Integration Points**: Focus on how modules interact, not just individual packages
8. **Test Functional Behavior**: Validate the bot works as a complete system
9. **Fix Issues**: Implement fixes with proper end-to-end and integration testing
10. **Document**: Update AGENT_ZERO_ISSUES.md with findings, especially integration problems

## Priority Areas

Based on the codebase structure, focus on **integration and end-to-end functionality**:

1. **Orchestrator Integration** - How orchestrator coordinates vision, solver, agents, and executor
2. **Decision Pipeline** - End-to-end flow from game state to action execution
3. **Agent-Stategy Integration** - How agent outputs are consumed by strategy engine
4. **Cross-Module Data Flow** - Type consistency and data transformation between packages
5. **Configuration Integration** - How config flows through all modules
6. **Error Handling Across Modules** - Fallback mechanisms when modules fail
7. **End-to-End Tests** - Functional tests that validate complete bot behavior
8. **Runtime Integration Issues** - Problems that only appear when all components run together

## Notes

- All code should be production-ready (no placeholders)
- Follow existing code style and patterns
- Maintain backward compatibility where possible
- Update tests when fixing bugs
- Document any breaking changes


## Player/Table State Map (Phase 2A Audit)

### 1. Derivation & Mutation
| State Component | Source (Vision) | Mutation/Inference Logic |
|----------------|-----------------|--------------------------|
| **Players** | stacks (Map) | Filtered by valid position names. |
| **Stacks** | stacks (Map) | Direct mapping. No smoothing/averaging in Parser. |
| **Cards** | cards.holeCards, cards.communityCards | Hero cards inferred from previousState if missing & inference enabled. |
| **Pot** | pot.amount | Direct mapping. |
| **Button** | buttons.dealer | Defaults to previousState.button or "BTN". |
| **Hero Pos** | N/A | Derived from previousState.hero or calculated from Button (defaulting to SB relative to BTN). |
| **Blinds** | **MISSING** | **Critical Gap**: Only derived from previousState or default {0,0}. No vision parsing. |
| **Street** | Derived from Community Card count | 0->Pre, 3->Flop, 4->Turn, 5->River. Fallback to previousState. |

### 2. State Synchronization (StateSyncTracker)
- **Drift Detection**:
  - **Pot Decrease**: Flags error if pot drops > 0.001 (unless new hand).
  - **Stack Increase**: Flags error if stack grows more than pot size (chip injection).
- **Reset Logic**:
  - **New Hand**: Detected via Street reset (Preflop), Card count drop, or Hand ID change.
  - **Action**: Clears history on new hand.
- **Behavior**: Passive. Adds errors to parseErrors. Does **not** correct the state.

### 3. Invariants & Enforcement
| Invariant | Enforced At | Mechanism |
|-----------|-------------|-----------|
| **Legal Actions** | legal-actions.ts | Computed based on stack, pot, and street. |
| **Street Progression** | parser.ts | Strictly tied to card count. |
| **Stack Integrity** | state-sync.ts | Checks for impossible stack increases. |
| **Forced Actions** | forced-actions.ts | Overrides decision if Blind/All-in forced. |

### 4. Top Desync Risks
1.  **Blind Level Stagnation**: Blinds are never updated from vision. Tournament play will fail when levels change.
    - *Validation*: Test fixture with changing blinds in vision output -> verify state update (currently fails).
2.  **Position Lock-in**: Hero position relies on previousState. If initialized wrong, it persists.
    - *Validation*: Test sequence where button moves but hero position remains stuck if not explicitly re-detected.
3.  **Hand Boundary Blur**: isNewHand relies on street/cards. Rapid restarts or replay glitches might merge two hands.
    - *Validation*: Replay harness with identical hand IDs but different cards.

## Phase 3: Cash Validation

**Added:**
- **Fixture Generator**: packages/orchestrator/test/cash-validation/fixtures/generate_fixture.ts creates a deterministic 3-hand 6-max cash game session.
- **Validation Tests**: packages/orchestrator/test/cash-validation/cash-validation.spec.ts validates:
  - State invariants (pot, stacks, blinds).
  - Position rotation (BTN -> CO -> MP for Hero).
  - Stack updates based on game outcomes.
  - State synchronization via StateSyncTracker.

**How to Run:**
1. Generate the fixture (if needed):
   bash
   npx tsx packages/orchestrator/test/cash-validation/fixtures/generate_fixture.ts
   
2. Run the tests:
   bash
   npx vitest run packages/orchestrator/test/cash-validation/cash-validation.spec.ts
   

## Phase 4: Cash-Game Desync Audit (Player/Table State)

**Status**: Completed
**Branch**: agent-zero/phase4-desync-audit-20260111

**Audit Targets & Results:**
1.  **Position Correctness (A)**: Verified that dealer button movement correctly updates Hero's position (BTN -> CO -> MP) across sequential hands using `desync-audit.spec.ts`.
2.  **Hand Boundary (B)**: Verified that rapid sequential hands (100ms gap) are correctly treated as separate hands with state resets (pot, etc.).
3.  **State-Sync Robustness (C)**: Verified that `StateSyncTracker` correctly detects impossible state changes (e.g., pot decrease within a hand) and that `GameStateParser` triggers `SafeAction` when these errors occur.

**Deliverables:**
- New test suite: `packages/orchestrator/test/desync-audit/desync-audit.spec.ts`
- Fixture generator: `packages/orchestrator/test/desync-audit/fixtures/generate_audit_fixture.ts`
- Full CI verification passed (`pnpm run ci:verify`).

**Conclusion:**
The cash-game state tracking is robust against common desync scenarios. The system correctly identifies and handles inconsistent frame deltas, ensuring safety mechanisms are triggered.

## Phase 5: Safety Rehearsals (Cash Games)

**Status**: Completed
**Branch**: agent-zero/phase5-safety-rehearsals-20260111

**Objective:**
Strengthen confidence in cash games by adding deterministic chaos and recovery rehearsals to prove that failures degrade safely without corrupting state.

**Rehearsal Scenarios & Results:**
1.  **Solver Failure**: Verified that when the solver throws/timeouts, the system falls back to a safe action (check/fold) and marks `solverTimedOut: true`.
2.  **Agent Failure**: Verified that when the agent coordinator fails, the system uses a stubbed agent output and proceeds with a GTO-based or safe decision.
3.  **Vision Desync**: Verified that impossible state transitions (e.g., pot decrease) are detected by `StateSyncTracker`, triggering `SafeAction` via `GameStateParser`.
4.  **Preemption**: Verified that `TimeBudgetTracker` errors are handled gracefully, defaulting to a safe path (GTO-only or SafeAction).
5.  **Recovery**: Verified `SafeModeController` latching behavior and manual exit requirements.

**Deliverables:**
- **New Test Suite**: `packages/orchestrator/test/safety-rehearsals/safety-rehearsals.spec.ts`
- **CI Verification**: `pnpm run ci:verify` passed.

**Runbook: How to Run Safety Rehearsals**

To run the safety rehearsals locally:

```bash
pnpm --filter @poker-bot/orchestrator exec vitest run test/safety-rehearsals/safety-rehearsals.spec.ts
```

**Pass Criteria:**
- All 5 scenarios must pass.
- No unhandled promise rejections.
- Logs should show expected warnings/errors (e.g., "GTO solver failed", "Safe mode entered") but the process should not crash.

## Phase 6: Player/Table State Audit (Cash Games)

**Status**: Completed
**Branch**: agent-zero/phase6-player-table-state-audit-20260111

**Objective:**
Harden CASH-game correctness by auditing and stress-testing Player/Table state logic for desynchronization risks (phantom chips, pot leaks, position drift).

**Audit Targets & Results:**
1.  **Position Stability (A)**: Verified BTN rotation and Hero position inference (BTN -> CO -> MP) across 3 sequential hands.
2.  **Stack Delta Integrity (B)**: Hardened `StateSyncTracker` to detect "phantom chips" (stack increases without corresponding pot wins). Verified detection of illegal stack jumps.
3.  **Pot Monotonicity (C)**: Verified that `StateSyncTracker` correctly flags pot decreases within a hand as inconsistencies.
4.  **Blind/Stack Conservation (D)**: Verified detection of "double blind posting" or stack leaks where chips vanish without entering the pot.

**Deliverables:**
- **New Test Suite**: `packages/orchestrator/test/state-audit/state-audit.spec.ts`
- **Fixture Generator**: `packages/orchestrator/test/state-audit/fixtures/generate_audit_fixture.ts`
- **Code Hardening**: Updated `packages/orchestrator/src/vision/state-sync.ts` to strictly enforce stack-pot conservation.
- **CI Verification**: `pnpm run ci:verify` passed.

**Runbook: How to Run Audit Tests**

```bash
pnpm --filter @poker-bot/orchestrator exec vitest run test/state-audit/state-audit.spec.ts
```

**Conclusion:**
The system now has explicit guards against silent state drift. `StateSyncTracker` is capable of detecting subtle integrity violations like phantom chip injection, ensuring the bot operates on valid game states.

## Phase 7: Golden Replay Pack + Regression Gate

**Status**: Completed
**Branch**: agent-zero/phase7-golden-replay-pack-20260111

**Objective:**
Build a curated "golden replay pack" of 8-12 nightmare scenarios that stress-test the cash game guards (StateSyncTracker, SafeMode, Invariant Checks). These run on every PR as a permanent regression gate.

**Scenarios & Expectations:**

| ID | Scenario | Expectation |
|----|----------|-------------|
| **G01** | Seat Wobble | Tracker detects missing player; recovers cleanly when player returns. |
| **G02** | Rapid Hand Transitions | Tracker resets state cleanly on new hand (<1s gap); no false positives. |
| **G04** | Position Drift | Tracker detects unexpected button movement mid-hand. |
| **G05** | Phantom Chips | Tracker detects stack increase without corresponding pot decrease. |
| **G06** | Pot Leak | Tracker detects pot decrease mid-hand without showdown. |
| **G08** | Stack Reload | Tracker allows stack increase between hands (clean reset). |
| **G10** | Blind Posting Edge Case | Tracker accepts partial blind posting (all-in) without error. |
| **G11** | Street Transition | Tracker handles rapid street changes (Flop->Turn->River) without false positives. |

**Deliverables:**
- **Fixture Generator**: `packages/orchestrator/test/golden-replay/fixtures/generate_golden_fixture.ts`
- **Test Suite**: `packages/orchestrator/test/golden-replay/golden-replay.spec.ts`
- **CI Integration**: Included in `pnpm run ci:verify`.

**Runbook: How to Run Golden Replay Tests**

```bash
pnpm --filter @poker-bot/orchestrator exec vitest run test/golden-replay/golden-replay.spec.ts
```

**Conclusion:**
The Golden Replay Pack provides a robust regression gate for critical cash game invariants. It ensures that the `StateSyncTracker` and system guards remain effective against known failure modes like phantom chips, position drift, and rapid state transitions.

## Phase 8: Vision & Solver Client Integration

**Status**: Completed
**Branch**: agent-zero/phase8-vision-solver-client-integration-20260111

**Objective:**
Integrate deterministic contract tests for Vision and Solver clients within the poker-bot orchestrator. Implement client-side timeout logic and safety guards for gRPC responses.

**Key Improvements:**
1.  **Client-Side Timeouts**: Implemented Promise.race logic in clients with configurable timeoutMs.
2.  **Safety Guards**: Enhanced handling of partial or malformed gRPC responses.
3.  **Contract Tests**: Created new test suites to verify communication, timeouts, and error recovery without network dependencies.

**Deliverables:**
- **Updated Clients**: packages/orchestrator/src/solver_client/client.ts, packages/orchestrator/src/vision/client.ts
- **New Test Suites**: 
  - packages/orchestrator/test/solver/client.spec.ts
  - packages/orchestrator/test/vision/client.spec.ts
- **CI Verification**: pnpm run ci:verify passed.

**Runbook: How to Run Client Tests**

bash
pnpm --filter @poker-bot/orchestrator exec vitest run test/solver/client.spec.ts
pnpm --filter @poker-bot/orchestrator exec vitest run test/vision/client.spec.ts


**Conclusion:**
The Vision and Solver clients now have robust, deterministic tests ensuring they handle timeouts and errors gracefully, preventing system hangs during network issues.

## Phase 9: Time Budget & Preemption Hardening

**Status**: Completed
**Branch**: agent-zero/phase9-time-budget-hardening-20260111

**Objective:**
Harden TimeBudgetTracker edge cases so time allocations are safe, monotonic, and never go negative.

**Key Improvements:**
1.  **Overrun Cascades**: Added deterministic tests proving overruns clamp component budgets at zero.
2.  **Global Preemption**: Verified `shouldPreemptTotal` behavior around the 100ms threshold.
3.  **Budget Safety**: Ensured remaining budgets never return negative values across components.

**Deliverables:**
- **Extended Test Suite**: packages/orchestrator/test/budget/timeBudgetTracker.spec.ts
- **CI Verification**: pnpm run ci:verify passed.

**Runbook: How to Run Time Budget Tests**

```bash
pnpm --filter @poker-bot/orchestrator exec vitest run test/budget/timeBudgetTracker.spec.ts
```

**Conclusion:**
Time budget guardrails now have regression coverage for cascade overruns and global preemption, preventing negative allocations under heavy load.

## Phase 10: Executor Error Paths & Verification

**Status**: Completed
**Branch**: agent-zero/phase10-executor-action-verification-20260111

**Objective:**
Harden the Executor layer by adding deterministic unit tests that cover critical failure paths and retry behavior. Ensure failures are surfaced (not swallowed), retries cap correctly, and raise sizing/amount validation is enforced.

**Key Improvements:**
1.  **SimulatorExecutor**: Updated to return failure on verification exhaustion and enforce strict raise amount validation (including non-finite values like NaN/Infinity).
2.  **ResearchUIExecutor**: Added early raise amount validation (including non-finite values), bet sizing failure surfacing, and retry limit enforcement.
3.  **Deterministic Tests**: Added comprehensive test suites covering:
    - Compliance check failures
    - Window manager errors
    - Vision/turn-state timeouts
    - Bet sizing failures
    - Retry logic capping (with stubbed delays for determinism)
    - Invalid raise amount validation (negative, NaN, Infinity)

**Deliverables:**
- **Updated Executors**: packages/executor/src/simulators/simulator.ts, packages/executor/src/research_bridge.ts
- **New Test Scenarios**: Added to packages/executor/test/simulator.spec.ts and packages/executor/test/research_bridge.spec.ts
- **CI Verification**: pnpm run ci:verify passed.

**Runbook: How to Run Executor Tests**

bash
pnpm --filter @poker-bot/executor exec vitest run test/simulator.spec.ts test/research_bridge.spec.ts


**Conclusion:**
The Executor layer now has robust error handling and verification logic, ensuring that invalid actions or system failures are correctly identified and reported, preventing undefined behavior during gameplay.
