# Task 14 – Verification Checklist

1. **Config / Schema**
   - [ ] `pnpm --filter "@poker-bot/shared" test`
   - [ ] Config hot reload updates `monitoring.observability` sinks without restart.
2. **Logger package**
   - [ ] `pnpm --filter "@poker-bot/logger" test`
   - [ ] Structured logger filters by level, rotates audit files, retries failed webhooks.
   - [ ] `ObservabilityReporter` emits `metrics_snapshot` JSON in `<sessionDir>/metrics/latest.json`.
3. **Orchestrator integration**
   - [ ] `pnpm --filter "@poker-bot/orchestrator" lint`
   - [ ] `pnpm --filter "@poker-bot/orchestrator" test`
   - [ ] Run orchestrator locally, confirm:
     - `observabilityService.recordDecision` writes snapshots.
     - `AlertManager` logs `alert_dispatched` when safe mode or panic stop triggers.
     - Health dashboard shows `/observability/metrics` payload.
4. **Docs**
   - [ ] `docs/observability.md` reviewed/linked from progress report.
