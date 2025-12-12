import type {
  AgentFailure,
  AgentOutput,
  AggregatedAgentOutput,
  CircuitBreakerState
} from "../types";
import type { CostGuardState } from "../policy/costGuard";
import type { ActionType } from "@poker-bot/shared/src/types";

export interface TelemetryEvent {
  requestId: string;
  outputs: AgentOutput[];
  failures: AgentFailure[];
  distribution: Map<ActionType, number>;
  costSummary: AggregatedAgentOutput["costSummary"];
  circuitBreaker: CircuitBreakerState;
  costGuardState: CostGuardState;
}

export class AgentTelemetryLogger {
  private readonly verbose: boolean;

  constructor(verbose: boolean) {
    this.verbose = verbose;
  }

  log(event: TelemetryEvent): void {
    const sanitizedOutputs = event.outputs.map(output => ({
      agentId: output.agentId,
      personaId: output.personaId,
      action: output.action,
      confidence: output.confidence,
      latencyMs: output.latencyMs,
      weight: (output.metadata as Record<string, unknown>)?.weight,
      tokenUsage: output.tokenUsage,
      reasoning: this.verbose ? output.reasoning : undefined
    }));

    const failures = event.failures.map(failure => ({
      agentId: failure.agentId,
      personaId: failure.personaId,
      reason: failure.reason,
      latencyMs: failure.latencyMs,
      details: failure.details
    }));

    const payload = {
      type: "agent_decision",
      requestId: event.requestId,
      outputs: sanitizedOutputs,
      failures,
      distribution: Object.fromEntries(event.distribution.entries()),
      costSummary: event.costSummary,
      circuitBreaker: event.circuitBreaker,
      costGuard: event.costGuardState
    };

    console.info(JSON.stringify(payload));
  }
}
