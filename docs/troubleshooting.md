# Troubleshooting Guide

This guide lists common operational issues, symptoms to watch for, and recommended remediation steps. Cross-reference `docs/operator_manual.md` for emergency procedures and `docs/backup_recovery.md` for state restoration.

## 1. Quick Reference Table

| Symptom | Likely Cause | Actions |
| --- | --- | --- |
| `panic:vision_confidence` latches immediately | Dirty layout pack, DPI drift, or news overlay | 1) Inspect latest screenshot; 2) Recalibrate layout pack; 3) Pause play until news timer lifts; 4) Re-run smoke tests. |
| Solver timeouts spike | Network partition or cache corruption | 1) Check solver container logs (`docker logs solver`); 2) Rebuild cache (`pnpm run cache:sync` if available); 3) Use chaos tests (`pnpm -r --filter "@poker-bot/orchestrator" test --filter chaos`). |
| Agent cost alerts | Misconfigured personas or degraded API | 1) Confirm OpenAI/Anthropic status; 2) Lower `agents.costPolicy.maxTokensDecision`; 3) Raise `strategy.alphaGTO`; 4) Reset circuit breaker (`/agents/circuit-breaker/reset`). |
| Action verifier retries exhausted | Research UI lost focus or board parsing failed | 1) Inspect executor video capture; 2) Re-center window via WindowManager CLI; 3) Increase `execution.verificationTimeoutMs` temporarily. |
| Safe mode oscillates between active/inactive | Health thresholds too sensitive | 1) Check health snapshots; 2) Adjust `monitoring.health.degradedThresholds`; 3) Re-run chaos suite to validate new settings. |
| Replay divergence >30pp | Config drift or RNG mismatch | 1) Re-run `pnpm --filter "@poker-bot/orchestrator" replay --mode smoke --hands 100`; 2) Verify `SESSION_ID` + seed seeding; 3) Ensure model hashes logged in hand history. |

## 2. Diagnostics Playbook

### Vision & Parser
1. `results/session/<id>/observability/vision*.jsonl` — inspect element confidences.
2. Run `pnpm --filter "@poker-bot/orchestrator" test --filter vision` for golden samples.
3. Validate layout pack with `pnpm --filter "@poker-bot/shared" test vision`.

### Solver
1. `docker logs solver` for CFR errors.
2. `ls config/cache` to confirm snapshots exist.
3. Run `pnpm --filter "@poker-bot/orchestrator" test --filter solver` to repro locally.

### Agents
1. Check `results/session/<id>/observability/agents*.jsonl` for latency/cost.
2. Ensure secrets present (`pnpm run verify:env`).
3. Use chaos suite LLM failure test to validate fallback path.

### Executor / Research UI
1. Review `results/session/<id>/verification*.jsonl`.
2. Confirm WindowManager allowlist matches active window titles.
3. Run `pnpm --filter "@poker-bot/executor" test` if available.

### Risk & Health
1. Inspect `results/session/health-*.jsonl` for recent snapshots.
2. Check `RiskStateStore` file referenced by `RISK_STATE_PATH`.
3. Ensure news CSV is fresh (timestamps within 24h).

## 3. Incident Checklist

1. Stop play (panic stop or kill switch).
2. Capture:
   - Git commit + config hash  
   - Session ID + timestamp  
   - Paths to logs / metrics / SBOM  
3. Run deterministic replay to reproduce.
4. File an issue with:
   - Root cause hypothesis  
   - Steps attempted  
   - Whether chaos suite reproduces the failure  
5. Only resume after engineering sign-off or after executing the recovery procedure in `docs/backup_recovery.md`.

Keep this guide updated whenever new failure modes surface. When adding entries, include log file paths and specific commands so the next operator can act quickly.*** End Patch

