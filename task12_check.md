## Task 12 – Deterministic Replay & RNG Seeding Checklist

- [ ] RNG utilities live in `@poker-bot/shared/src/rng.ts` with `generateRngSeed` + `validateSeed`.
- [ ] `ActionSelector` + `StrategyEngine` derive seeds from `handId:sessionId` and store them in `StrategyDecision.metadata.rngSeed`.
- [ ] All fallback paths (SafeAction, GTO-only, BetSizer failure, risk fallback) reuse the derived seed.
- [ ] Executors (simulator + research UI + bet input handler) draw jitter from the hand seed instead of `Math.random`.
- [ ] Model version collector captures LLM, vision, and GTO cache versions and `buildHandRecord` writes them under `metadata.modelVersions`.
- [ ] `HandRecord.metadata` now includes `rngSeed` and `modelVersions` and logger redaction respects the new shape.
- [ ] Shared + orchestrator unit tests cover RNG helpers, selector determinism, model version collector caching, and replay determinism.
- [ ] `docs/replay.md` (or equivalent) explains how to replay a logged hand by reusing the logged seed/session ID.
- [ ] `design.md` and `progress.md` mention deterministic replay + model version metadata.
- [ ] Verification: `pnpm --filter "@poker-bot/orchestrator" lint && pnpm --filter "@poker-bot/orchestrator" test && pnpm --filter "@poker-bot/orchestrator" build`.
- [ ] Verification: `pnpm --filter "@poker-bot/shared" test`.
- [ ] Verification: `pnpm --filter "@poker-bot/logger" test`.
