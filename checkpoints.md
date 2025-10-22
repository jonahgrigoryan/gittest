## Checkpoints and Hold Points

Purpose: enforce go/no-go gates, keep the 2s SLA, and lock compliance/safety before expanding scope. Each checkpoint lists what to validate, what to run, and acceptance criteria ties.

### Checkpoint 1 — After Task 1 (Project scaffolding)
- **Validate**: build compiles; type definitions in `shared` compile; solver stubs link; lint clean.
- **Run**: TypeScript build; basic test runner smoke.
- **Criteria**: repo builds green locally/CI skeleton.

### Checkpoint 2 — After Task 2.4 (Configuration Manager complete)
- **Validate**: load/validate config; hot‑reload with rollback; subscriptions fire.
- **Run**: configuration validator tests; hot‑reload exercise with invalid→rollback→valid.
- **Criteria**: requirements 8.1–8.6 satisfied.

### Checkpoint 3 — After Tasks 3.1–3.3 (Vision: layout packs, extraction, confidence/occlusion)
- **Validate**: golden images parse cards/stacks/pot/buttons with confidences; occlusion gating works.
- **Run**: golden vision suite with perf asserts.
- **Criteria**: requirements 1.1–1.3, 1.6–1.9; **P95 perception ≤70ms** including parsing hand‑off.

### Checkpoint 4 — After Tasks 3.4–3.5 & 3.7 (Parser + SafeAction)
- **Validate**: `GameState` structure; positions assignment; legal actions; SafeAction triggers on low confidence/occlusion; forced actions honored.
- **Run**: parser unit tests; SafeAction policy suite.
- **Criteria**: requirements 1.4, 1.8, 10.3, 10.6.

### Checkpoint 5 — After Task 4.1 (GTO cache foundation)
- **Validate**: fingerprint stability; cache loads; hit/miss behavior; budget short‑circuit to cache.
- **Run**: cache query tests; fingerprint regression fixtures.
- **Criteria**: requirements 2.1, 2.6.

### Checkpoint 6 — After Tasks 4.2–4.4 (Subgame solver + deep‑stack + outputs)
- **Validate**: subgame returns within 400ms cap; deep‑stack action set triggers >100bb; outputs include probs/EV/regret; respects preemption.
- **Run**: solver timeout/budget tests; deep‑stack scenario fixtures.
- **Criteria**: requirements 2.2–2.5.

### Checkpoint 7 — After Tasks 5.1–5.4 (Agent Coordinator core)
- **Validate**: 3+ agents queried in parallel; strict JSON schema; malformed outputs discarded; aggregation deterministic; Brier tracking initialized.
- **Run**: agent schema validator; timeout and malformed output handling; provider mocks.
- **Criteria**: requirements 3.1–3.5, 3.7.

### Checkpoint 8 — After Tasks 6.1–6.3 (Time Budget Tracker)
- **Validate**: allocations; preemption flags; dynamic reductions when perception overruns; P50/P95/P99 recorded.
- **Run**: budget tracking tests; simulated component overruns.
- **Criteria**: requirement 4.6.

### Checkpoint 9 — After Tasks 7.1–7.2 (Risk Guard)
- **Validate**: bankroll/session gates; panic stop signal; integration hook for Strategy Engine.
- **Run**: RiskGuard unit tests (limits breach, remaining, panic stop).
- **Criteria**: requirement 10.4.

### Checkpoint 10 — After Tasks 8.1–8.5 (Strategy Engine)
- **Validate**: α‑blend correctness; seeded RNG action selection; bet quantization legality/clamping; divergence >30pp logs full trace; GTO‑only fallback on agent timeouts; risk checks enforced.
- **Run**: strategy unit tests (blend, sampling, quantization, divergence); deterministic replay.
- **Criteria**: requirements 4.1–4.5, 4.7.
- **Do now**: run Task 12.1 (seeded RNG determinism) to make downstream tests reproducible.

### Checkpoint 11 — Before Research UI: prove execution path (sim/api) — After Tasks 9.1 + 9.3–9.4
- **Validate**: action translation; exact bet sizing; post‑action verification; bounded single retry then halt on mismatch.
- **Run**: simulator/API executor tests with mocks; verification mismatch path.
- **Criteria**: requirements 5.1, 5.4–5.6.

### Checkpoint 12 — Compliance gating for Research UI — After Task 9.2
- **Validate**: research UI mode gated by allowlist; prohibited sites refused.
- **Run**: compliance validator tests (allowlist/denylist permutations).
- **Criteria**: requirements 0.2–0.5, 5.2–5.3.

### Checkpoint 13 — Research UI automation — After Tasks 9.5–9.7 (GATED/optional)
- **Validate**: window detection by title/process; ROI→screen mapping; hero‑turn detection; button locations ≥99% accuracy; randomized timing; SafeAction on detection failure.
- **Run**: headless/UI mocks where possible; manual smoke on allowlisted client.
- **Criteria**: requirement 5.7 and compliance rules.

### Checkpoint 14 — Hand History Logger — After Tasks 10.1–10.6
- **Validate**: full per‑hand record; JSON + ACPC export; retention; persist ≤1s after hand complete; latency distributions collected.
- **Run**: logger export tests; retention job tests; metrics calculations.
- **Criteria**: requirements 6.1–6.8.

### Checkpoint 15 — Health Monitor & Panic Stop — After Tasks 11.1–11.3
- **Validate**: periodic component health; enter/exit safe mode; executor lock; panic stop on 3× low‑confidence frames.
- **Run**: induced component failures; safe mode behavior; panic stop triggers.
- **Criteria**: requirements 7.2–7.3, 10.5.

### Checkpoint 16 — Startup compliance validation — After Task 13.2
- **Validate**: environment validation at startup (allowlist, blocked sites); halt if non‑compliant.
- **Run**: startup compliance tests.
- **Criteria**: requirement 0.5.

### Checkpoint 17 — E2E Orchestration — After Tasks 13.1–13.3
- **Validate**: full pipeline on synthetic states; end‑to‑end ≤2s at P95; error handling/fallbacks wired.
- **Run**: integration E2E; reproducible replay with fixed seed.
- **Criteria**: requirements 4.1, 7.1, 7.4. (Requires Checkpoint 16 complete.)

### Checkpoint 18 — Observability — After Tasks 14.1–14.3
- **Validate**: structured logging levels; metrics (perf/decision/health/cost); alerts.
- **Run**: observability regression tests; alerting smoke.
- **Criteria**: requirements 6.8, 7.5.

### Checkpoint 19 — Evaluation Harness — After Tasks 15.1–15.2
- **Validate**: offline evaluation loop; shadow mode (decisions only); A/B toggles.
- **Run**: short offline sim; shadow harness over dataset.
- **Criteria**: requirements 9.1–9.5; targets tracked (≥3bb/100 vs static, ≥0bb/100 vs mixed‑GTO, ε≤0.02).

### Checkpoint 20 — Packaging, Deployment, and CI — After Tasks 16.1–16.4
- **Validate**: deterministic container builds; compose up; CI runs mandatory suites and perf gates; env var/key management.
- **Run**: CI pipeline; container builds; perf thresholds enforcement.
- **Criteria**: requirement 10.2; CI blocks merges unless all mandatory suites are green.

---

## Unit test suites to schedule (by task)
- **Task 2.4**: Configuration validator (valid/invalid, hot‑reload rollback, subscriptions).
- **Tasks 3.6–3.7**: Vision golden suite + SafeAction policy; include P95 perception budget asserts.
- **Task 4.1**: Cache fingerprint stability (minor perturbations), cache hit/miss, budget short‑circuit.
- **Task 4.3**: Deep‑stack action set activation (>100bb) and differences.
- **Task 4.4**: Solver regression fixtures (probs/EV/regret) and timeout behavior.
- **Task 5.6**: Agent JSON schema validator; timeout/malformed handling; circuit breaker if present.
- **Task 6.3**: Time Budget Tracker allocation/preemption/dynamic adjustments.
- **Task 7.2**: RiskGuard limits, remaining, panic stop signaling.
- **Tasks 8.2–8.5**: Strategy sampling determinism, bet size quantization legality/clamping, divergence logging.
- **Task 9.3**: Action verification strictness and bounded retry.
- **Task 9.7**: Research UI turn‑wait and button detection mapping.
- **Tasks 10.5–10.6**: Logger metrics and retention policy.
- **Tasks 11.2–11.3**: Safe mode and panic stop behaviors.
- **Task 12.1**: RNG determinism (seeded) — run immediately after Task 8.5 completion.
- **Task 12.2**: Metadata hashing (LLM weights, vision versions, cache version).
- **Task 13.2**: Compliance startup validator (allowlist/denylist, mode gating).
- **Task 13.3**: Pipeline smoke with 2s SLA assertions.
- **Tasks 14.1–14.2**: Observability regressions (logs/metrics steady‑state).
- **Tasks 15.1–15.2**: Offline and shadow harness smokes.
- **Task 16.4**: CI gate covering all mandatory suites.

---

## Quick acceptance checklist (at each checkpoint)
- **Tests pass**: all unit/integration/perf tests for the checkpointed tasks are green.
- **2s SLA**: end‑to‑end decision loop meets ≤2s at P95 before advancing beyond Checkpoint 17.
- **Compliance**: research UI automation is gated by allowlist; startup compliance validated before full pipeline.
- **CI**: merges are blocked unless mandatory suites pass and perf gates hold.
