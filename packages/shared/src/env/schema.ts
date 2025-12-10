export type EnvSchema = {
  required: string[];
  optional?: string[];
  allowEmpty?: string[];
};

export type EnvService =
  | "root"
  | "orchestrator"
  | "agents"
  | "executor"
  | "logger"
  | "evaluator"
  | "solver"
  | "vision";

export const ENV_SCHEMAS: Record<EnvService, EnvSchema> = {
  root: {
    required: [
      "RESULTS_DIR",
      "LOGS_DIR",
      "CONFIG_DIR",
      "CACHE_DIR",
      "HEALTH_DASHBOARD_PORT",
      "OBSERVABILITY_PORT",
      "SOLVER_HOST",
      "SOLVER_PORT",
      "VISION_HOST",
      "VISION_PORT"
    ]
  },
  orchestrator: {
    required: [
      "BOT_CONFIG",
      "VISION_SERVICE_URL",
      "SOLVER_ADDR",
      "RISK_STATE_PATH",
      "LOGGER_OUTPUT_DIR"
    ],
    optional: [
      "SESSION_ID",
      "CONFIG_WATCH",
      "EVALUATION_MODE",
      "EVALUATION_RUN_ID",
      "ORCH_PING_SOLVER",
      "ORCH_PING_VISION"
    ],
    allowEmpty: ["SESSION_ID", "CONFIG_WATCH", "EVALUATION_MODE", "EVALUATION_RUN_ID"]
  },
  agents: {
    required: ["OPENAI_API_KEY"],
    optional: [
      "ANTHROPIC_API_KEY",
      "OPENAI_BASE_URL",
      "OPENAI_MODEL",
      "AGENT_MAX_LATENCY_MS",
      "AGENT_BUDGET_TOKENS"
    ]
  },
  executor: {
    required: ["EXECUTOR_MODE", "WINDOW_MANAGER", "COMPLIANCE_CHECKER", "SAFE_ACTION_FALLBACK"],
    optional: ["RESEARCH_UI_PORT"]
  },
  logger: {
    required: ["LOGGER_OUTPUT_DIR", "LOGGER_RETENTION_DAYS", "METRICS_EXPORTER"],
    optional: ["ENABLE_REDACTION"]
  },
  evaluator: {
    required: ["HANDS_DIR", "EVAL_OUTPUT_DIR"],
    optional: ["SESSION_PREFIX", "SMOKE_HAND_CAP"]
  },
  solver: {
    required: ["SOLVER_PORT", "SOLVER_CACHE_PATH"]
  },
  vision: {
    required: ["VISION_PORT", "VISION_MODEL_PATH", "VISION_LAYOUT_PACK"]
  }
};

