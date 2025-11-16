## Task 13 – Replay Harness & Evaluation Prep Checklist

- [ ] `packages/shared/src/replay.ts` exports replay result/comparison/report interfaces.
- [ ] `packages/orchestrator/src/replay/reader.ts` streams JSONL HandRecords with `handId/limit/offset` filters; `findHandRecordFile` respects `logging.sessionPrefix`.
- [ ] `packages/orchestrator/src/replay/deserialize.ts` round-trips `SerializedGameState` (see `test/replay/deserialize.spec.ts`).
- [ ] Decision pipeline extracted to `packages/orchestrator/src/decision/pipeline.ts` and consumed by `main.ts`.
- [ ] `ModelVersionValidator` compares logged vs current LLM/vision/cache versions and surfaces mismatches/warnings (strict mode supported).
- [ ] `ReplayEngine` replays a hand/batch, reports diffs/divergence/timing, and aggregates batch metrics.
- [ ] CLI (`pnpm --filter "@poker-bot/orchestrator" replay …`) instantiates config/solvers/strategy engine, locates JSONL files, and prints summary + optional JSON report.
- [ ] `docs/replay.md`, `progress.md`, and `report.md` mention the new tooling/usage.
- [ ] Verification commands executed:
  - `pnpm --filter "@poker-bot/shared" test`
  - `pnpm --filter "@poker-bot/orchestrator" lint`
  - `pnpm --filter "@poker-bot/orchestrator" test`
  - `pnpm --filter "@poker-bot/orchestrator" build`
  - `pnpm --filter "@poker-bot/orchestrator" replay --sessionId <sample>` (strict run optional)
