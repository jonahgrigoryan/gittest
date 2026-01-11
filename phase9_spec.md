You are Agent Zero working in: /a0/usr/projects/poker-bot

BRANCH RULES
- You are already on the working branch: agent-zero/phase9-time-budget-hardening-20260111
- Do NOT create or rename branches.
- Do NOT merge/rebase. Commit only to the current branch.

MISSION (PHASE 9 — TIME BUDGET & PREEMPTION HARDENING)
Harden TimeBudgetTracker edge cases so time allocations are safe, monotonic, and never go negative.
Add deterministic tests that prove preemption behavior when budgets are tiny (<100ms) and when overruns cascade.

SCOPE / CONSTRAINTS
- Prefer tests first. Make the smallest code changes needed to satisfy correctness.
- Deterministic + CI-friendly: no timers/sleeps, no wall-clock dependency (avoid Date.now in tests; inject a clock only if needed).
- Do NOT commit generated artifacts (results/, logs/, metrics.jsonl, etc.). Keep `git status` clean.
- Keep changes limited to TimeBudgetTracker and its tests, unless a tiny StrategyEngine-facing helper is required.

WHAT TO BUILD
A) Extend tests: `packages/orchestrator/test/budget/timeBudgetTracker.spec.ts`
Add coverage for these cases:
   - Group new cases under `describe('Phase 9: Time Budget Hardening', ...)` within the existing file.

1) applyOverrun() cascade can reduce component budgets to 0
   - Create a tracker with budgets for multiple components (gto/agents/vision/etc).
   - Call recordActual()/applyOverrun() such that one component overruns and triggers cascade.
   - Assert: affected component remaining budget clamps at 0, never negative.
   - Assert: other components are reduced in a predictable way (according to existing contract).
   - Assert: total remaining clamps at >= 0.

2) Component allocation never goes negative
   - Reserve/startComponent/endComponent sequences that could cause underflow.
   - Apply multiple overruns in a row.
   - Assert every internal component remaining is >= 0 after each operation.
   - Assert remaining() returns >= 0.

3) Preemption with <100ms remaining (global preempt)
   - Add a global preemption signal:
     - Either implement helper on TimeBudgetTracker: `shouldPreemptTotal(thresholdMs = 100): boolean`
     - OR, if an existing method already provides equivalent semantics, codify it and test it.
   - Tests must show:
     - remaining total 99ms => shouldPreemptTotal() true
     - remaining total 100ms => false (or whichever boundary is consistent; be explicit)
     - remaining total 0ms => true

4) Downstream components never go negative
   - When total budget hits 0, ensure component budgets also clamp to 0.
   - Ensure `remaining("gto")`, `remaining("agents")`, etc. never return negatives.

5) recordActual() with overrun cascades + remaining() clamps
   - Create scenario where actual time > reserved time by a large amount.
   - Ensure recordActual results in overrun handling and final budgets are sane (>=0).
   - Confirm remaining() and any per-component query clamp to >= 0.

B) Minimal implementation tweaks in `packages/orchestrator/src/budget/timeBudgetTracker.ts` ONLY if tests expose a real bug:
   - Clamp any subtraction paths to 0.
   - Ensure applyOverrun cascade cannot drive values negative.
   - Add global preempt helper if not already present.
   - Do not refactor extensively.

ACCEPTANCE CRITERIA
- `pnpm --filter @poker-bot/orchestrator run lint` passes.
- `pnpm --filter @poker-bot/orchestrator exec vitest run test/budget/timeBudgetTracker.spec.ts` passes.
- `pnpm run ci:verify` passes.
- `git status` is clean after running CI (restore any ignored/generated files if needed).
- Tests are deterministic and exercise the exact edge cases above.
- All existing TimeBudgetTracker tests still pass (regression check).

WORK PLAN (DO THIS)
1) Inspect current TimeBudgetTracker implementation and existing tests.
2) Write the new tests first; run them and observe failures.
3) Apply the smallest code changes needed to satisfy the contract (clamps, helper method).
4) Re-run:
   - orchestrator lint
   - the TimeBudgetTracker spec
   - full `pnpm run ci:verify`
5) Commit as a single commit:
   - `feat(test): harden time budget preemption edge cases`
6) If all pnpm checks pass, push the commit to trigger CI.

FINAL RESPONSE FORMAT
- Brief summary of what you added/changed
- Exact files added/modified
- Commands you ran (and outcomes)
- How I should run the new tests locally
- Confirmation that `pnpm run ci:verify` passed and `git status` is clean
