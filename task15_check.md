# Task 15 – Evaluation Framework Checklist

- [ ] `pnpm --filter "@poker-bot/shared" test`
- [ ] `pnpm --filter "@poker-bot/evaluator" lint`
- [ ] `pnpm --filter "@poker-bot/evaluator" test`
- [ ] `pnpm --filter "@poker-bot/evaluator" build`
- [ ] Run `pnpm --filter "@poker-bot/evaluator" exec tsx src/cli/eval.ts smoke --hands 100` and inspect summary JSON
- [ ] Document runbook updates in `docs/evaluation.md`
