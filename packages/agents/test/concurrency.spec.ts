import { describe, it, expect, vi } from "vitest";
import { executeAgentTasks, AgentTimeoutError } from "../src";
import type { AgentTaskRunner, AgentConcurrencyOptions, TimeBudgetTracker } from "../src";

function createOptions(overrides: Partial<AgentConcurrencyOptions> = {}): AgentConcurrencyOptions {
  return {
    perAgentTimeoutMs: 50,
    sharedBudgetMs: 100,
    ...overrides
  };
}

describe("executeAgentTasks", () => {
  it("resolves fulfilled results when agents finish within budget", async () => {
    const tasks: AgentTaskRunner<string>[] = [
      {
        agentId: "a1",
        run: async () => "ok"
      },
      {
        agentId: "a2",
        run: async () => "still-ok"
      }
    ];

    const results = await executeAgentTasks(tasks, createOptions());
    expect(results).toHaveLength(2);
    expect(results.every(result => result.status === "fulfilled")).toBe(true);
    expect(results.map(result => result.value)).toEqual(["ok", "still-ok"]);
  });

  it("rejects with AgentTimeoutError when per-agent timeout is exceeded", async () => {
    const tasks: AgentTaskRunner<string>[] = [
      {
        agentId: "slow",
        run: (signal) =>
          new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason));
            setTimeout(() => resolve("late"), 30);
          })
      }
    ];

    const results = await executeAgentTasks(tasks, createOptions({ perAgentTimeoutMs: 5, sharedBudgetMs: 10 }));
    expect(results[0].status).toBe("rejected");
    expect(results[0].reason).toBeInstanceOf(AgentTimeoutError);
  });

  it("propagates upstream abort signals", async () => {
    const controller = new AbortController();
    const tasks: AgentTaskRunner<string>[] = [
      {
        agentId: "abort-me",
        run: (signal) =>
          new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason));
            setTimeout(() => resolve("never"), 30);
          })
      }
    ];

    const promise = executeAgentTasks(tasks, createOptions({ signal: controller.signal }));
    setTimeout(() => controller.abort(new Error("cancelled")), 5);
    const results = await promise;
    expect(results[0].status).toBe("rejected");
    expect(results[0].reason).toBeInstanceOf(Error);
    expect((results[0].reason as Error).message).toBe("cancelled");
  });

  it("returns immediate rejection when budget tracker denies reservation", async () => {
    const tracker: TimeBudgetTracker = {
      reserve: vi.fn().mockReturnValue(false)
    };
    const tasks: AgentTaskRunner<string>[] = [
      {
        agentId: "denied",
        run: async () => "nope"
      }
    ];

    const results = await executeAgentTasks(tasks, createOptions({ timeBudgetTracker: tracker }));
    expect(results[0].status).toBe("rejected");
    expect(tracker.reserve).toHaveBeenCalledWith("agents", 100);
  });
});
