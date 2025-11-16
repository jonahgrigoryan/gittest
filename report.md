# Task 13 – Replay Harness & Evaluation Prep Report

## Summary
- Added shared replay/report interfaces plus streaming HandRecord readers and a `deserializeGameState` helper so logged JSONL entries can be rehydrated exactly.
- Extracted the orchestrator decision pipeline into `decision/pipeline.ts`, built a `ModelVersionValidator`, and implemented a `ReplayEngine` that compares actions, RNG seeds, blended distributions, timing, and model versions per hand while aggregating batch statistics.
- Introduced a `pnpm --filter "@poker-bot/orchestrator" replay …` CLI that loads the production config/solvers/strategy engine, locates session JSONL files, validates model versions (strict mode optional), and emits JSON reports for offline analysis—closing Req. 9.x / 10.3.
- Updated `docs/replay.md`, `task13_check.md`, and `progress.md` to describe the workflow and verification steps.

## Testing / Verification
- `pnpm --filter "@poker-bot/shared" test`
- `pnpm --filter "@poker-bot/orchestrator" lint`
- `pnpm --filter "@poker-bot/orchestrator" test`
- `pnpm --filter "@poker-bot/orchestrator" build`
- Manual CLI smoke:
  - `pnpm --filter "@poker-bot/orchestrator" replay --sessionId <session>`
  - `pnpm --filter "@poker-bot/orchestrator" replay --sessionId <session> --strict-versions`
