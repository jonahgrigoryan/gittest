export type BudgetComponent = "perception" | "gto" | "agents" | "synthesis" | "execution" | "buffer";

export interface BudgetAllocation {
  perception: number;
  gto: number;
  agents: number;
  synthesis: number;
  execution: number;
  buffer: number;
}

export interface BudgetMetrics {
  samples: number;
  p50: number;
  p95: number;
  p99: number;
  lastSample: number;
}

export const DEFAULT_TOTAL_BUDGET_MS = 2000;

export const DEFAULT_BUDGET_ALLOCATION: BudgetAllocation = {
  perception: 70,
  gto: 400,
  agents: 1200,
  synthesis: 100,
  execution: 30,
  buffer: 200
};
