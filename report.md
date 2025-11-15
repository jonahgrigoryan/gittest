# Task 11 – Health Monitor & Safe Mode Report

## Summary
- Added shared health contracts (`packages/shared/src/health.ts`) plus config/schema defaults for `monitoring.health`.
- Implemented orchestrator health modules:
  - `HealthMetricsStore` gathers vision/solver/executor/strategy stats.
  - `HealthMonitor` drives periodic checks, toggles safe mode, and emits snapshots.
  - `SafeModeController` and `PanicStopController` gate execution.
  - Optional HTTP/SSE dashboard streams current health.
- Wired `main.ts` to update metrics each decision, append snapshots to `results/session/health-<session>.jsonl`, reference health snapshot IDs in hand history, and block executor when safe mode or panic stop is active.
- Added vitest coverage for monitor/safe-mode/panic-stop flows plus Task 11 checklist.

## Testing
- `pnpm test --filter "@poker-bot/logger"`
- `pnpm test --filter "@poker-bot/orchestrator"`
