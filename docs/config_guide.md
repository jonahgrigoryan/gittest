# Configuration Guide

This guide explains the structure of `bot-config.json`, tuning levers, and how each module consumes the values. Use it alongside `config/schema/bot-config.schema.json` for precise validation.

## 1. High-Level Structure

```jsonc
{
  "compliance": { … },
  "vision": { … },
  "gto": { … },
  "agents": { … },
  "strategy": { … },
  "execution": { … },
  "safety": { … },
  "logging": { … },
  "monitoring": {
    "health": { … },
    "observability": { … }
  },
  "evaluation": { … }
}
```

## 2. Section Details & Tuning Tips

### Compliance
- **gameType**: `NLHE_6max` or `HU_NLHE`; controls solver abstractions and vision parsing heuristics.
- **blinds**: base stake for risk guard calculations and logging.
- **allowedEnvironments / siteAllowlist**: gate research UI executor so it only attaches to Legal environments.

### Vision
- **layoutPack**: relative path under `config/layout-packs`. Keep per-site packs versioned.
- **dpiCalibration**: scale factor the parser uses to align ROIs.
- **confidenceThreshold / occlusionThreshold**: adjust SafeAction sensitivity. Lower confidence → more conservative autopilot.

### GTO Solver
- **cachePath**: directory with precomputed solutions (`config/cache` default). Keep warm for fast startups.
- **subgameBudgetMs**: hard ceiling when solving new nodes; lowering reduces latency but may increase exploitability.
- **deepStackThreshold**: effective stack (bb) where solver switches to rich action sets.

### Agents
- **models**: ordered list of persona IDs from `config/bot/personas/*.json`.
- **timeoutMs**: per-agent deadline enforced by the coordinator.
- **outputSchema**: JSON schema validated with Ajv; extend when new agent metadata is needed.
- **costPolicy**: safety rails (tokens/latency). Circuit breaker auto-trips when thresholds are exceeded.
- **personaOverrides**: fine-tune prompts/temperatures per persona.

### Strategy
- **alphaGTO**: blend weight (0–1). Increase for safer play, decrease to lean on agents.
- **betSizingSets**: normalized bet sizes per street. Must align with site increments; solver/strategy validation will clamp.
- **divergenceThresholdPP**: deviation alert threshold (percentage points).
- **opponentModeling**: enable/disable statistics ingestion; requires Task 8.6 backing store.

### Execution
- **enabled / mode**: `simulator` or `research-ui`. Leave disabled for analysis-only runs.
- **verifyActions / maxRetries / verificationTimeoutMs**: ActionVerifier controls.
- **simulatorEndpoint**: HTTP endpoint for the simulator executor; schema expects a URI.
- **researchUI**: allow/prohibit site lists plus the build flag requirement.

### Safety
- **bankrollLimit / sessionLimit**: triggers panic stop when exceeded.
- **panicStopConfidenceThreshold / panicStopConsecutiveFrames**: forwarded to HealthMetrics → PanicStopController.

### Logging
- **outputDir / sessionPrefix**: JSONL hand history locations.
- **flushIntervalMs / maxFileSizeMb / retentionDays**: throughput vs. durability tradeoffs.
- **redaction.fields**: scrub PII; defaults remove names, IDs, and reasoning text.
- **metrics**: per-hand rolling windows for win-rate and latency stats.

### Monitoring
- **health.intervalMs**: cadence for health snapshots; keep ≤5 s in live play.
- **degradedThresholds**: align with your panic-stop policy; mismatched values cause false positives.
- **observability.logs.sinks**: enable console/file/webhook. Each sink has `enabled` + specific transport options.
- **observability.alerts**: channel list, cooldowns, and trigger definitions. Wire to Slack/PagerDuty via webhook sink.

### Evaluation
- Configure opponent presets, hand caps, and seeds for `pnpm --filter "@poker-bot/evaluator" ...` runs.
- AB-testing block allows parallel experiments with confidence targets.

## 3. Workflow

1. **Edit configs** in `config/bot/*.json`. Keep changes small and reviewable.
2. **Validate** with:
   ```bash
   pnpm run verify:env   # ensures env + schema hydration
   pnpm --filter "@poker-bot/shared" test config
   ```
3. **Hot reload** (optional) by setting `CONFIG_WATCH=1` before launching the orchestrator.
4. **Track config hashes**: the orchestrator logs `configHash` for each hand; include it in incident reports.

## 4. Common Tuning Scenarios

| Scenario | Knobs |
| --- | --- |
| Agents too expensive | Lower `agents.costPolicy.maxTokensDecision` or `alphaGTO` ↑ |
| Vision misreads | Increase `vision.confidenceThreshold`, tighten `occlusionThreshold`, update layout pack |
| Solver overruns budget | Reduce `gto.subgameBudgetMs`, raise `strategy.alphaGTO`, or expand cache |
| Aggressive opponents exploit bot | Decrease `strategy.alphaGTO`, add exploitative persona overrides |
| Risk guard too tight | Revisit `safety.bankrollLimit/sessionLimit` only after compliance review |

## 5. Versioning & Promotion

- Treat config changes like code: PR + review + CI.
- Tag releases with `configHash` and store in `progress.md`.
- For emergency overrides, annotate `docs/backup_recovery.md` so the next operator knows how to revert.

Keep this guide synchronized with `config/schema/bot-config.schema.json` whenever new fields are introduced.*** End Patch

