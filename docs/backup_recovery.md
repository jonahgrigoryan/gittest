# Backup & Recovery Guide

Use this guide to preserve critical runtime artifacts and recover the system after host failures, data corruption, or secret rotation events.

## 1. What to Back Up

| Component | Path | Frequency | Notes |
| --- | --- | --- | --- |
| Config snapshots | `config/bot/*.json`, `config/layout-packs/` | After every change | Store alongside release tags. |
| Solver caches | `config/cache/` | Daily + before large updates | Large files; compress before uploading. |
| Risk state | `<RISK_STATE_PATH>` (defaults to `results/session/risk-state.json`) | Hourly | Contains bankroll/session counters; treat as sensitive. |
| Session logs | `results/session/<sessionId>/` | After each session | Includes observability, health, decisions. |
| Hand histories | `results/hands/` | After each session | Feed for evaluation + audits. |
| SBOM + signatures | `sbom/sbom.spdx.json` + `.sig` | Every CI run | Needed for provenance verification. |
| Environment bundles | `.env`, `env/.env.*` | After rotation | Store encrypted. |

## 2. Backup Procedure

1. **Quiesce the system**: finish the current hand or enter safe mode.
2. **Archive directories**
   ```bash
   tar czf backups/session-$SESSION_ID.tgz \
     config/bot \
     config/layout-packs \
     config/cache \
     results/session/$SESSION_ID \
     results/hands \
     sbom
   ```
3. **Upload** to your storage backend (S3, GCS, etc.) with encryption at rest.
4. **Record metadata**: git commit, config hash, panic stop state, news feed timestamps.

## 3. Recovery Scenarios

### 3.1 Host Failure / Fresh Node
1. Provision machine (match CPU/RAM/GPU requirements).
2. Install dependencies (`pnpm`, Docker, Python, Rust toolchain).
3. Restore archived tarball.
4. Run `pnpm install && pnpm run verify:env`.
5. Bring stack up with `docker compose ... up --build`. Verify solver cache mounts.

### 3.2 Solver Cache Corruption
1. Stop orchestrator to avoid unsafe play.
2. Restore `config/cache/` from last known good backup.
3. Re-run solver unit tests (`pnpm -r --filter "@poker-bot/orchestrator" test --filter solver`).
4. Resume play once chaos suite passes.

### 3.3 Risk State Mismatch
1. Compare `results/session/risk-state.json` with hand histories.
2. If corrupt, reconstruct using replay:
   ```bash
   pnpm --filter "@poker-bot/orchestrator" replay --mode audit --input results/hands/<session>.jsonl
   ```
3. Update risk state file manually, log the adjustment, and archive old copy.

### 3.4 Secret Rotation
1. Update secrets in your manager.
2. Re-export `.env` files and rerun `pnpm run verify:env`.
3. Restart containers with `docker compose down && docker compose up`.
4. Delete old env bundles from disk.

## 4. Verification After Recovery

1. `pnpm -r --filter "./packages/**" run lint`
2. `pnpm -r --filter "./packages/**" run test`
3. `pnpm --filter "@poker-bot/orchestrator" replay --mode smoke --hands 200`
4. Run chaos suite (`pnpm -r --filter "@poker-bot/orchestrator" test --filter chaos`)
5. Record results in the incident log.

## 5. Rolling Back a Release

1. **Identify the target build**
   - Grab the last known-good tag/digest from the CI release job (`docker buildx imagetools inspect ghcr.io/<repo>-orchestrator:vX.Y.Z`).
   - Download the matching SBOM/signature from the GitHub Release and run `cosign verify`.
2. **Deploy to staging**
   ```bash
   docker compose --env-file .env.staging pull orchestrator solver vision
   docker compose --env-file .env.staging up -d orchestrator
   ```
   - Wait for the orchestrator health check before proceeding.
3. **Promote to production**
   - Repeat the pull/up sequence with `.env.prod`.
   - Monitor health snapshots + replay smoke (`pnpm --filter "@poker-bot/orchestrator" replay --mode smoke --hands 200 --input results/hands/latest.jsonl`).
4. **Rollback automation**
   - If health snapshots degrade, immediately run `docker compose --env-file .env.prod down -v` and redeploy the previously healthy digest.
   - Archive the failing session’s logs/SBOMs for audit.
5. **Post-rollback**
   - Update `progress.md` with the rollback details (tag, digests, reason).
   - File a follow-up task to address the regression before attempting another promotion.

Keep this document synchronized with actual operational practice. Whenever you discover a new recovery gap, file an issue and update this guide before closing the incident.*** End Patch

