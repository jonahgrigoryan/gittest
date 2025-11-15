# Replay Guide

Task 12 introduced deterministic RNG seeding plus model/version metadata so every logged hand can be replayed exactly. This guide summarizes the process.

## 1. Capture Context from HandRecord

Each entry emitted by `@poker-bot/logger` (JSONL under `results/hands/session_<ID>/`) includes:

- `sessionId`
- `decision.metadata.rngSeed`
- `metadata.modelVersions` (LLM, vision, GTO cache)
- Serialized game state (`rawGameState`)

Example snippet:

```jsonc
{
  "handId": "HH2024-08-01-00123",
  "sessionId": "session_lz4fj3",
  "decision": {
    "metadata": {
      "rngSeed": 214748364,
      "configHash": "1e2c…",
      "...": "..."
    }
  },
  "metadata": {
    "modelVersions": {
      "llm": { "gto_purist": { "modelId": "gpt-4.1", "provider": "openai" } },
      "vision": { "modelFiles": ["default.layout.json"], "versions": { "default.layout.json": "6d1…" } },
      "gtoCache": { "manifestVersion": "1.0.0", "fingerprintAlgorithm": "sha256-v1" }
    }
  }
}
```

## 2. Re-run Orchestrator with the Same Session

1. Set `SESSION_ID` env var to the logged `sessionId`.
2. Feed the serialized `rawGameState` back through the orchestrator (or a replay harness) so that `state.handId` matches.
3. Ensure the same config + cache/artifacts are loaded. `modelVersions` should match—if not, refresh the assets first.

Because `StrategyEngine` derives the RNG seed via `generateRngSeed(state.handId, sessionId)`, matching both values replays the exact RNG sequence.

## 3. Verify Outputs

- `StrategyDecision.metadata.rngSeed` should equal the logged seed.
- `decision.action` and `reasoning.blendedDistribution` should match unless inputs changed (e.g., different game state).
- Executors and jittered delays now also consume the same seed, so simulated execution timelines remain consistent.

## 4. Forcing Overrides

Developers can temporarily set `strategy.rngSeed` in the bot config to pin the RNG for ad-hoc experiments. The override takes precedence over the derived hand/session hash and is reflected in every HandRecord.

## 5. Troubleshooting

- If replay diverges, confirm the `modelVersions` (LLM prompt templates, layout pack hash, GTO cache manifest) match the original session.
- Health/safe-mode transitions can still alter the control flow, but every branch reuses the derived seed so SafeAction/GTO-only fallbacks remain reproducible.
