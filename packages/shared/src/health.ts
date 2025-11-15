export type HealthState = "healthy" | "degraded" | "failed";

export interface HealthStatus {
  component: string;
  state: HealthState;
  checkedAt: number;
  latencyMs?: number;
  details?: string;
  metrics?: Record<string, number>;
  consecutiveFailures: number;
}

export interface HealthCheckDefinition {
  name: string;
  frequencyMs?: number;
  fn: () => Promise<HealthStatus>;
  concurrency?: "serial" | "parallel";
}

export interface SafeModeState {
  active: boolean;
  reason?: string;
  enteredAt?: number;
  manual?: boolean;
}

export interface PanicStopReason {
  type: "vision_confidence" | "risk_limit" | "manual";
  detail: string;
  triggeredAt: number;
}

export interface HealthSnapshot {
  overall: HealthState;
  statuses: HealthStatus[];
  safeMode: SafeModeState;
  panicStop?: PanicStopReason;
  issuedAt: number;
  id: string;
}

export function computeOverallHealth(statuses: HealthStatus[]): HealthState {
  if (statuses.some(status => status.state === "failed")) {
    return "failed";
  }
  if (statuses.some(status => status.state === "degraded")) {
    return "degraded";
  }
  return "healthy";
}
