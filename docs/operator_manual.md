# Operator Manual — Poker Bot Runtime

This guide walks operators through everyday procedures for bringing the stack online, monitoring health, and executing emergency actions. It assumes Task 16 deployment artifacts and Task 17 hardening work are in place.

## 1. Preflight Checklist

1. **Update repo & configs**
   - `git pull` on `main`.
   - Regenerate caches/layout packs if configs changed.
2. **Secrets**
   - Copy the latest `.env` bundle from your secret manager.
   - Run `pnpm run verify:env` to validate templates before deploy.
3. **Hardware budget**
   - Ensure the host has ≥12 CPU cores, ≥32 GB RAM, and a dedicated GPU if using high-res vision.
4. **News guards**
   - Refresh `Files/RPEA/news/calendar_high_impact.csv` or confirm the API feed is healthy.
5. **Results/log storage**
   - Verify `RESULTS_DIR`, `LOGS_DIR`, and `CACHE_DIR` exist and have write permissions.

## 2. Startup Procedure

1. **Smoke the stack locally** (optional)
   ```bash
   pnpm -r --filter "./packages/**" run build
   pnpm -r --filter "@poker-bot/orchestrator" test
   pnpm run verify:env
   ```
2. **Bring up Docker services**
   ```bash
   cd infra/compose
   docker compose --env-file ../../.env up --build solver vision orchestrator
   ```
3. **Watch logs**
   ```bash
   docker compose logs -f orchestrator
   ```
   Look for:
   - Solver + vision handshake complete
   - `health_snapshot` events reporting `overall=healthy`
4. **Run evaluation smoke (optional)**
   ```bash
   docker compose --profile tools run --rm evaluator smoke --hands 500
   ```
5. **Record session metadata**
   - Session ID (from orchestrator logs)
   - Config hash
   - Git commit, SBOM, cosign signature references

## 3. Shutdown Procedure

1. **Exit safe mode / panic stop** (if active) to flush pending logs.
2. **Graceful stop**
   ```bash
   docker compose down -v
   ```
3. **Archive artifacts**
   - `results/session/<sessionId>`
   - `logs/`
   - `sbom/sbom.spdx.json` and signature
4. **Rotate secrets** if any emergency override occurred.

## 4. Monitoring & Alarms

- **Health dashboard** (`HEALTH_DASHBOARD_PORT`) exposes component states and panic stop latch.
- **Observability service** emits JSONL logs in `results/session/<sessionId>/observability`.
- **Alert manager** (Task 14+) forwards panic stop, agent cost overruns, solver timeouts, and degraded health windows to the configured channels.
- **Time budget metrics**: use `results/session/<sessionId>/budget.jsonl` (emitted by StrategyEngine) to track P95 for each component.

## 5. Safe Mode & Panic Stop Playbook

| Scenario | Action |
| --- | --- |
| Vision confidence < threshold for ≥3 frames | Panic stop fires automatically. Confirm via logs, review vision feed, restart after root cause fixed. |
| Risk guard breach | Orchestrator auto-enters panic stop and logs the offending metric. Reset only after bankroll/session state is reconciled. |
| Operator-initiated safe mode | Run the CLI command or hit the dashboard toggle. System will hold check/fold until manually cleared. |

**Reset sequence after panic stop**
1. Run deterministic replay (`pnpm --filter "@poker-bot/orchestrator" replay --mode smoke`) against the affected hands.
2. Inspect `docs/troubleshooting.md` for targeted diagnostics.
3. Only exit panic stop once the replay is clean AND health snapshots stay `healthy` for ≥2 iterations.

## 6. Kill Switch / Emergency Exit

1. Trigger panic stop via dashboard or CLI (`/health/panic-stop` endpoint) to freeze new actions.
2. If automation misbehaves, kill the orchestrator container immediately (`docker kill orchestrator`).
3. Archive all logs and alert engineering leadership before resuming play.

## 7. Chaos Drill Cadence

- Weekly: run the automated Vitest chaos suite (`pnpm -r --filter "@poker-bot/orchestrator" test --runInBand --reporter verbose | tee chaos.log`).
- Monthly: perform live chaos drills (solver restart, agent outage, executor misfire) in staging following Task 17.2 steps. Record outcomes in `docs/drills/YYYY-MM-DD.md` (create if missing).

## 8. Release & Promotion Checklist

1. Confirm the latest CI run for the target branch/tag shows all jobs green (`build`, `security`, `docker`, `smoke_compose`, `release` for tags).
2. Review `results/verification.json` (uploaded in the `test-artifacts` bundle) for replay-smoke metrics (action match rate, divergence, timing P95).
3. Capture image digests:
   ```bash
   docker buildx imagetools inspect ghcr.io/<repo>-orchestrator:sha-<commit>
   ```
4. Verify Cosign signatures if signing is enabled:
   ```bash
   cosign verify --key <public-key> ghcr.io/<repo>-orchestrator:vX.Y.Z
   ```
5. Update `progress.md` with tag, commit, digests, SBOM links, and replay stats; archive the workflow URL.
6. Notify `#poker-bot-ops` once the release webhook confirms promotion, then follow staged rollout steps.

## 9. Contacts & Escalation

- **Primary operators**: rotation documented in `progress.md`.
- **Engineering on-call**: Slack `#poker-bot-ops`, PagerDuty schedule `poker-bot-runtime`.
- **Security**: notify if any secret exposure or cosign verification failure occurs.

Keep this manual updated whenever deployment tooling or monitoring flows change. Cross-reference `docs/config_guide.md`, `docs/troubleshooting.md`, and `docs/backup_recovery.md` for deeper dives.

