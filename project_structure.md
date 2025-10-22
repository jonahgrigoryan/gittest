# Project Structure (recommended)

Source of truth order: `requirements.md` → `design.md` → `tasks.md`. Native Research-UI runs on macOS; services run in Linux containers.

```text
poker-bot/
├── README.md
├── requirements.md
├── design.md
├── tasks.md
├── checkpoints.md
├── config/
│   ├── bot/
│   │   ├── default.bot.json
│   │   └── staging.bot.json
│   ├── schema/
│   │   └── bot-config.schema.json
│   └── layout-packs/
│       ├── research-ui/
│       └── simulator/
├── proto/
│   ├── vision.proto
│   ├── solver.proto
│   ├── agents.proto
│   ├── strategy.proto
│   ├── executor.proto
│   └── logging.proto
├── packages/
│   ├── orchestrator/
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── config/
│   │   │   ├── budget/
│   │   │   ├── strategy/
│   │   │   ├── safety/
│   │   │   ├── solver_client/
│   │   │   ├── agent_client/
│   │   │   ├── execution/
│   │   │   └── logging/
│   │   └── test/
│   │       ├── config.spec.ts
│   │       ├── strategy.spec.ts
│   │       └── pipeline.spec.ts
│   ├── agents/
│   │   ├── src/
│   │   │   ├── coordinator.ts
│   │   │   ├── personas/
│   │   │   ├── schema/
│   │   │   └── transports/
│   │   └── test/agent_schema.spec.ts
│   ├── executor/
│   │   ├── src/
│   │   │   ├── simulators/
│   │   │   ├── research_bridge.ts
│   │   │   └── verifier.ts
│   │   └── test/verifier.spec.ts
│   └── logger/
│       ├── src/
│       │   ├── hand_history.ts
│       │   └── exporters/
│       └── test/retention.spec.ts
├── services/
│   ├── vision/
│   │   ├── src/
│   │   │   ├── capture/
│   │   │   ├── inference/
│   │   │   ├── parser/
│   │   │   └── api.py
│   │   └── tests/
│   │       ├── vision_golden.spec.py
│   │       └── safe_action.spec.py
│   └── solver/
│       ├── src/
│       ├── tests/
│       └── models/
├── native/
│   └── research_ui_helper/
│       ├── window_detection/
│       ├── turn_detector/
│       ├── button_locator/
│       ├── click_executor/
│       └── tests/turn_detection.spec.ts
├── tests/
│   ├── integration/
│   │   ├── e2e_pipeline.spec.ts
│   │   └── shadow_mode.spec.ts
│   └── fixtures/
│       ├── frames/
│       └── game_states/
├── tools/
│   ├── scripts/
│   │   ├── summarize.cjs
│   │   └── frame_bridge_bench.py
│   └── profiling/
├── infra/
│   ├── docker/
│   │   ├── orchestrator.Dockerfile
│   │   ├── agents.Dockerfile
│   │   ├── solver.Dockerfile
│   │   └── vision.Dockerfile
│   ├── compose/docker-compose.yml
│   ├── ci/
│   │   ├── github/
│   │   └── scripts/
│   └── kubernetes/
├── results/
├── logs/
└── coverage/
```

## Key Points
- Vision runs natively on macOS for Research-UI (Metal); in CI it can run CPU-only in Linux.
- All services write machine-readable outputs into `results/` so AI agents can parse them.
- `requirements.md`, `design.md`, `tasks.md`, and `checkpoints.md` stay at repo root for single-source traceability.
