export type {
  BudgetAllocation,
  BudgetComponent,
  BudgetMetrics,
} from "@poker-bot/shared";

import type { BudgetAllocation } from "@poker-bot/shared";
import {
  DEFAULT_BUDGET_ALLOCATION as SHARED_DEFAULT_ALLOCATION,
  DEFAULT_TOTAL_BUDGET_MS as SHARED_TOTAL_BUDGET_MS,
} from "@poker-bot/shared";

export interface TimeBudgetTrackerOptions {
  totalBudgetMs?: number;
  allocation?: Partial<BudgetAllocation>;
  metricsWindowSize?: number;
  now?: () => number;
  logger?: {
    warn?(message: string, meta?: Record<string, unknown>): void;
  };
}

export const DEFAULT_TOTAL_BUDGET_MS = SHARED_TOTAL_BUDGET_MS;

export const DEFAULT_BUDGET_ALLOCATION: BudgetAllocation = {
  ...SHARED_DEFAULT_ALLOCATION,
};
