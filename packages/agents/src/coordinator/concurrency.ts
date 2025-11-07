import { performance } from "node:perf_hooks";
import type { TimeBudgetTracker } from "../types";

export class AgentTimeoutError extends Error {
  constructor(agentId: string, budgetMs: number) {
    super(`Agent ${agentId} timed out after ${budgetMs}ms`);
    this.name = "AgentTimeoutError";
  }
}

export interface AgentTaskRunner<T> {
  agentId: string;
  run: (signal: AbortSignal, allottedMs: number) => Promise<T>;
}

export interface AgentConcurrencyOptions {
  perAgentTimeoutMs: number;
  sharedBudgetMs: number;
  timeBudgetTracker?: TimeBudgetTracker | null;
  signal?: AbortSignal;
}

export interface AgentConcurrencyResult<T> {
  agentId: string;
  status: "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  aborted: boolean;
  allottedMs: number;
}

const BUDGET_COMPONENT = "agents";

export async function executeAgentTasks<T>(
  tasks: AgentTaskRunner<T>[],
  options: AgentConcurrencyOptions
): Promise<AgentConcurrencyResult<T>[]> {
  if (tasks.length === 0) {
    return [];
  }

  const trackerReserved = reserveBudget(options.timeBudgetTracker, options.sharedBudgetMs);
  if (!trackerReserved) {
    const reason = new Error("Insufficient time budget for agent execution");
    return tasks.map(task => immediateRejection(task.agentId, reason));
  }

  const deadline = performance.now() + Math.max(0, options.sharedBudgetMs);
  const executions = tasks.map(task => runTask(task, options, deadline));
  return Promise.all(executions);
}

async function runTask<T>(
  task: AgentTaskRunner<T>,
  options: AgentConcurrencyOptions,
  sharedDeadline: number
): Promise<AgentConcurrencyResult<T>> {
  const startedAt = performance.now();
  const allottedMs = computeAllottedMs(options.perAgentTimeoutMs, sharedDeadline, startedAt);

  if (allottedMs <= 0) {
    return immediateTimeout(task.agentId);
  }

  const controller = new AbortController();
  const detachUpstream = attachUpstreamSignal(options.signal, controller);
  const timeoutId = setTimeout(() => controller.abort(new AgentTimeoutError(task.agentId, allottedMs)), allottedMs);

  try {
    const value = await task.run(controller.signal, allottedMs);
    const completedAt = performance.now();
    clearTimeout(timeoutId);
    return {
      agentId: task.agentId,
      status: "fulfilled",
      value,
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      aborted: controller.signal.aborted,
      allottedMs
    };
  } catch (error) {
    const completedAt = performance.now();
    clearTimeout(timeoutId);
    return {
      agentId: task.agentId,
      status: "rejected",
      reason: error,
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      aborted: controller.signal.aborted,
      allottedMs
    };
  } finally {
    detachUpstream();
  }
}

function reserveBudget(tracker: TimeBudgetTracker | null | undefined, sharedBudgetMs: number): boolean {
  if (!tracker) {
    return true;
  }
  try {
    return tracker.reserve(BUDGET_COMPONENT, sharedBudgetMs);
  } catch {
    return false;
  }
}

function computeAllottedMs(perAgentTimeoutMs: number, sharedDeadline: number, startedAt: number): number {
  const sharedRemaining = sharedDeadline - startedAt;
  return Math.max(0, Math.min(perAgentTimeoutMs, sharedRemaining));
}

function attachUpstreamSignal(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) {
    return () => {
      /* noop */
    };
  }
  if (signal.aborted) {
    controller.abort(signal.reason);
    return () => {
      /* noop */
    };
  }

  const listener = () => controller.abort(signal.reason);
  signal.addEventListener("abort", listener, { once: true });
  return () => {
    signal.removeEventListener("abort", listener);
  };
}

function immediateRejection(agentId: string, reason: unknown): AgentConcurrencyResult<never> {
  const now = performance.now();
  return {
    agentId,
    status: "rejected",
    reason,
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    aborted: false,
    allottedMs: 0
  };
}

function immediateTimeout(agentId: string): AgentConcurrencyResult<never> {
  const error = new AgentTimeoutError(agentId, 0);
  return immediateRejection(agentId, error);
}
