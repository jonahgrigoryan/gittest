# Task 11 Checklist

Use this list before declaring Task 11 complete:

- [ ] `pnpm --filter "@poker-bot/orchestrator" lint`
- [ ] `pnpm --filter "@poker-bot/orchestrator" test`
- [ ] `pnpm --filter "@poker-bot/orchestrator" build`
- [ ] (Optional) start health dashboard locally and verify `/health` + `/events`
- [ ] Trigger safe mode by simulating degraded component (e.g., force agent timeout) and confirm executor halts
- [ ] Trigger panic stop via mocked low vision confidence or risk limit breach; ensure makeDecision stops executing actions
- [ ] Check `results/session/health-<sessionId>.jsonl` contains snapshots
- [ ] Verify HandHistory entries include `healthSnapshotId`
