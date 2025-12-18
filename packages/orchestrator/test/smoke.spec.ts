import path from "node:path";
import { beforeAll, describe, it, expect } from "vitest";
import { run } from "../src/main";
import { TimeBudgetTracker } from "../src/budget/timeBudgetTracker";

describe("orchestrator", () => {
  beforeAll(() => {
    const repoRoot = path.resolve(__dirname, "../../..");
    process.env.BOT_CONFIG = path.resolve(repoRoot, "config/bot/default.bot.json");
    process.env.VISION_SERVICE_URL = "vision:50052";
    process.env.SOLVER_ADDR = "solver:50051";
    process.env.RISK_STATE_PATH = path.resolve(repoRoot, "results/session/risk-test.json");
    process.env.LOGGER_OUTPUT_DIR = path.resolve(repoRoot, "results/test-logs");
    process.env.ORCH_SKIP_STARTUP_CHECKS = "1";
  });

  it("runs without contacting solver", async () => {
    const res = await run();
    expect(res.ok).toBe(true);
    const tracker = res.budget.createTracker();
    expect(tracker).toBeInstanceOf(TimeBudgetTracker);
  }, 15000);
});
