# Evaluation Framework Overview

Task 15 introduces the evaluation package responsible for offline smoke tests, large-scale suite runs, shadow mode, and A/B experiments. Key pieces:

- `packages/shared/src/evaluation.ts` – shared types for configs, opponent profiles, and aggregate reports. Helpers `computeWinRateStats` and `createEvaluationReport` provide deterministic metrics.
- `packages/evaluator/` – new workspace exposing simulator, opponent registry, harness, and CLI (`pnpm --filter "@poker-bot/evaluator" exec node dist/cli/eval.js smoke`).
- Config additions: `evaluation` block in `config/bot/*.bot.json` defines default opponents and run parameters.
- Results: evaluation runs produce JSONL metrics + summary JSON under `results/eval/<runId>`.

Use the CLI entrypoints:

```bash
# Smoke test against default opponent pool
pnpm --filter "@poker-bot/evaluator" exec tsx src/cli/eval.ts smoke --hands 2000

# Full offline suite with explicit config + metrics directory
pnpm --filter "@poker-bot/evaluator" exec tsx src/cli/eval.ts offline --config ../../config/bot/default.bot.json --metricsDir ../../results/eval

# Shadow mode targeting a recorded session folder
pnpm --filter "@poker-bot/evaluator" exec tsx src/cli/eval.ts shadow --session session_2024_01_01

# A/B test two bot configs
pnpm --filter "@poker-bot/evaluator" exec tsx src/cli/eval.ts ab-test --variantA ../../config/bot/default.bot.json --variantB ../../config/bot/experiment.bot.json --hands 50000
```

The CLI wires each offline/offline_full/ab-test run into the orchestrator decision pipeline via `PipelineDecisionProvider`, so the simulator exercises the full solver → agents → blending stack. Use `--opponent` to override configured pools and `--metricsDir` to redirect JSONL metrics. Shadow mode now reuses `findHandRecordFile` + `readHandRecords` helpers to resolve `hand_records.jsonl` under `results/hands/<session>`.

When running evaluations against the live orchestrator, export `EVALUATION_RUN_ID`, `EVALUATION_MODE`, and optional `EVALUATION_OPPONENT_ID` so `HandRecord.metadata.evaluation` and downstream loggers can correlate hands with the evaluation run.
