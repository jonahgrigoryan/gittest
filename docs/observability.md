# Observability

Task 14 introduces end-to-end observability for the orchestrator runtime so decisions, health, and alerts can be audited after every session.

## Configuration

The `monitoring.observability` block in `config/bot/*.bot.json` controls logs, metrics, and alerts:

```json
"monitoring": {
  "observability": {
    "logs": {
      "level": "info",
      "sinks": {
        "console": { "enabled": true },
        "file": {
          "enabled": true,
          "outputDir": "../../results/session/audit",
          "maxFileSizeMb": 25,
          "maxFiles": 10
        },
        "webhook": {
          "enabled": false,
          "url": "https://example.com/hook",
          "batchSize": 10
        }
      }
    },
    "metrics": {
      "flushIntervalMs": 5000,
      "maxRecentHands": 200,
      "emitHandSummaries": false
    },
    "alerts": {
      "enabled": false,
      "cooldownMs": 60000,
      "channels": [],
      "triggers": {
        "panicStop": { "enabled": true },
        "safeMode": { "enabled": true },
        "solverTimeouts": { "enabled": true, "threshold": 3, "windowHands": 5 },
        "agentCost": { "enabled": true, "threshold": 500 },
        "healthDegradedMs": { "enabled": true }
      }
    }
  }
}
```

The configuration hot-reloads through `ConfigurationManager.subscribe("monitoring.observability", ...)` so sink levels, destinations, or alert thresholds can be changed at runtime without restarting the orchestrator.

## Structured logging

`packages/logger/src/structuredLogger.ts` fans structured events to the configured sinks:

- `console` sink renders JSON to stdout.
- `file` sink writes JSONL under `<outputDir>/audit`, rotating by size and pruning old files.
- `webhook` sink batches events and POSTs to the configured endpoint with retry and a basic circuit breaker.

Each event carries the session ID, component, deduplication key, and arbitrary payload. Child loggers inherit default context for subsystem-specific metadata.

## Metrics & reporter

`MetricsCollector` measures win rate, EV accuracy, latency quantiles, fallback counts, solver timeouts, safe-mode/panic-stop counts, execution success rate, and agent LLM token/cost totals. The `ObservabilityReporter` wraps the collector, stores a rolling buffer of recent hands, and emits JSON snapshots to `<sessionDir>/metrics/latest.json`. Every flush also emits a `metrics_snapshot` structured log for dashboards and alert evaluation.

## Observability service

`packages/orchestrator/src/observability/service.ts` wires everything together:

- Instantiates sinks + `StructuredLogger`.
- Instantiates `ObservabilityReporter`.
- Provides helpers (`recordDecision`, `recordAgentTelemetry`, `recordSafeMode`, `recordPanicStop`, `recordHealthSnapshot`) that the orchestrator uses after every hand and health snapshot.
- Registers `AlertManager`, which evaluates metrics snapshots/events and emits semantic `alert_dispatched` events when thresholds trip.

The service flushes before process exit to avoid losing buffered metrics.

## Dashboard & endpoints

The health dashboard reads metrics snapshots from `<results>/session/<sessionId>/metrics/latest.json` and the audit JSONL tail to render live observability status (metrics view, structured log tail, alert banner).

## Verification

1. `pnpm --filter "@poker-bot/shared" test`
2. `pnpm --filter "@poker-bot/logger" test`
3. `pnpm --filter "@poker-bot/orchestrator" lint`
4. `pnpm --filter "@poker-bot/orchestrator" test`
5. Run the orchestrator locally, trigger a safe mode or panic stop, and inspect:
   - `results/session/<SESSION>/audit/*.jsonl`
   - `results/session/<SESSION>/metrics/latest.json`
   - `health-<SESSION>.jsonl` snapshots
   - dashboard `/observability/metrics` endpoint
