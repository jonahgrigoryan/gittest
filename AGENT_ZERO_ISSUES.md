# Agent Zero Codebase Review - Issue Tracker

## Review Session: Sat Jan 10 03:53:54 AM UTC 2026

### Summary
- **Branch**: agent-zero/review-fixes-20260108
- **Base**: agent-zero-codebase-review
- **Reviewer**: Agent Zero
- **Status**: In Progress
- **Review Focus**: Bot-wide integration and end-to-end functionality

---

## Issues Found

### Critical Issues

#### [ISSUE-001] - Silent Error Suppression in Strategy Engine
- **Severity**: Critical
- **Package**: @poker-bot/orchestrator
- **File**: src/strategy/engine.ts (Lines ~350-360)
- **Description**:
  - The shouldPreempt function wraps its logic in a try-catch block that catches all errors and returns false without logging.
  - **Snippet**:
    typescript
    private shouldPreempt(): boolean {
      // ...
      try {
        // ... logic ...
      } catch {
        return false; // Error swallowed here
      }
    }
    
  - **Current Behavior**: If the time budget tracker fails or throws, the error is swallowed, and the system proceeds as if no preemption is needed.
  - **Failure Mode**: Critical runtime errors (e.g., memory issues, logic bugs in tracker) are hidden, potentially leading to timeouts or undefined behavior downstream.
- **Steps to Reproduce**:
  1. Mock TimeBudgetTracker.remaining() to throw an error.
  2. Call StrategyEngine.decide().
  3. Observe that no error is logged, and execution continues.
- **Proposed Fix**: Log the error with a warning before returning the safe fallback (false).
- **Status**: Fixed (Commit: Fix(orchestrator): log and handle shouldPreempt errors safely)

#### [ISSUE-002] - Silent Error Suppression in Health Monitor
- **Severity**: Critical
- **Package**: @poker-bot/orchestrator
- **File**: src/health/monitor.ts (Lines ~50-60)
- **Description**:
  - Errors during health check execution are caught and swallowed inside runChecks.
  - **Snippet**:
    typescript
    try {
      const status = await def.fn();
      // ...
    } catch (error) {
      statuses.push({ ... }); // Pushes failed status but DOES NOT LOG the error
    }
    
  - **Current Behavior**: If a health check throws, it is ignored/swallowed without logging the stack trace or error details to the system logger.
  - **Failure Mode**: The bot could be in a degraded state (e.g., vision service down) but operators won't see the root cause in the logs.
- **Steps to Reproduce**:
  1. Create a health check that throws an error.
  2. Run the health monitor.
  3. Observe that the error is not logged.
- **Proposed Fix**: Log the error explicitly in the catch block.
- **Status**: Fixed (Commit: Fix(orchestrator): report failing health checks instead of swallowing errors)

---

### High Priority Issues

#### [ISSUE-003] - Type Safety Bypass in Main Initialization
- **Severity**: High
- **Package**: @poker-bot/orchestrator
- **File**: src/main.ts (Line ~200)
- **Description**:
  - The configManager is cast to any when creating the AgentCoordinatorService.
  - **Snippet**: configManager: (useMockAgents ? ... : configManager) as any
  - **Current Behavior**: TypeScript type checking is disabled for this critical dependency injection.
  - **Failure Mode**: If the AgentCoordinatorService expects a specific interface that configManager doesn't satisfy (e.g., after a refactor), it will crash at runtime instead of failing at compile time.
- **Steps to Reproduce**:
  1. Inspect src/main.ts around line 200.
- **Proposed Fix**: Define a proper interface for the config proxy or use a union type, removing the as any cast.

#### [ISSUE-004] - Type Safety Bypass in Replay Tool
- **Severity**: High
- **Package**: @poker-bot/orchestrator
- **File**: src/cli/replay.ts
- **Description**:
  - Similar to main.ts, configManager is cast to any.
  - **Current Behavior**: Type safety is bypassed.
  - **Failure Mode**: Runtime crashes during replay if config structure mismatches.
- **Steps to Reproduce**:
  1. Inspect src/cli/replay.ts.
- **Proposed Fix**: Implement proper typing for the mock config injection.

---

### Medium Priority Issues

#### [ISSUE-005] - Missing Environment Dependencies
- **Severity**: Medium
- **Package**: services/vision, services/solver
- **File**: N/A (Environment)
- **Description**:
  - The current environment lacks poetry (Python) and cargo (Rust).
  - **Current Behavior**: Cannot run tests for Vision and Solver services.
  - **Failure Mode**: Inability to verify changes in these services.
- **Steps to Reproduce**:
  1. Run poetry --version or cargo --version.
- **Proposed Fix**: Use Docker Compose to run these services in their own containers.
  - **Command**:
    bash
    cd infra/compose
    docker-compose up -d vision solver
    # Then run integration tests against these containers
    

---

## Phase 1 Summary
The system is structurally sound and passes CI. The primary risks identified are silent error suppression and type safety gaps in critical paths.


#### [ISSUE-006] - Missing Blind Level Detection
- **Severity**: High
- **Package**: @poker-bot/orchestrator
- **File**: src/vision/parser.ts
- **Description**:
  - The GameStateParser does not extract blind levels from VisionOutput. It relies entirely on previousState.blinds or defaults to zero.
  - **Snippet**: blinds: previousState?.blinds ?? { small: 0, big: 0 }
  - **Current Behavior**: Blinds are static. If the game changes blind levels (e.g., tournament), the bot will continue using old values.
  - **Failure Mode**: Incorrect pot odds calculations, wrong raise sizing, and failure to identify forced actions correctly in tournaments.
- **Steps to Reproduce**:
  1. Create a test case where VisionOutput (hypothetically) contains new blind info.
  2. Pass it to parser.parse().
  3. Observe that state.blinds remains unchanged.
- **Proposed Fix**: Update VisionOutput schema to include blinds (if available) and update parser to read them.
