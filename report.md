# Task 12 – Deterministic Replay & RNG Seeding Report

## Summary
- Added shared RNG helpers (`packages/shared/src/rng.ts`) and updated `ActionSelector`, `StrategyEngine`, and all fallbacks to derive seeds deterministically from `handId:sessionId`, storing the value in every `StrategyDecision`.
- Extended executor jitter/backoff code (simulator + research UI + bet input handler) to consume the logged seed instead of `Math.random`, ensuring end-to-end replay fidelity.
- Introduced `ModelVersionCollector` plus serialized `modelVersions` metadata so HandRecords capture LLM persona models, vision layout hash, and GTO cache manifest per hand.
- Updated orchestrator logging (`buildHandRecord`) to include the RNG seed + model versions, added replay documentation (`docs/replay.md`), a Task 12 checklist, and new unit/integration tests (shared RNG helpers, selector determinism, collector caching, deterministic replay).

## Testing
- `pnpm --filter "@poker-bot/shared" test`
- `pnpm --filter "@poker-bot/logger" test`
- `pnpm --filter "@poker-bot/orchestrator" lint`
- `pnpm --filter "@poker-bot/orchestrator" test`
- `pnpm --filter "@poker-bot/orchestrator" build`
