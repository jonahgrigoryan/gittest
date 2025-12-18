import { describe, expect, it } from "vitest";
import { assertEnvVars, EnvValidationError, getMissingEnvVars } from "../src/env/validator";

describe("env validator", () => {
  it("returns missing keys", () => {
    const missing = getMissingEnvVars("orchestrator", {
      BOT_CONFIG: "/config/bot.json",
      SOLVER_ADDR: "",
      LOGGER_OUTPUT_DIR: "results/logs"
    });

    expect(missing).toContain("SOLVER_ADDR");
    expect(missing).toContain("VISION_SERVICE_URL");
  });

  it("allows optional keys to be empty", () => {
    expect(() =>
      assertEnvVars("orchestrator", {
        BOT_CONFIG: "config.json",
        VISION_SERVICE_URL: "vision:50052",
        SOLVER_ADDR: "solver:50051",
        RISK_STATE_PATH: "/tmp/risk.json",
        LOGGER_OUTPUT_DIR: "./results",
        SESSION_ID: ""
      })
    ).not.toThrow();
  });

  it("throws helpful error", () => {
    expect(() => assertEnvVars("agents", {})).toThrowError(EnvValidationError);
  });
});

