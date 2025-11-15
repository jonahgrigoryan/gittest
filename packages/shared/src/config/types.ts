import type { JSONSchemaType } from "ajv";

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export type GameType = "HU_NLHE" | "NLHE_6max";
export type AgentProvider = "openai" | "anthropic" | "local";
export type ExecutionMode = "simulator" | "api" | "research-ui";
export type AllowedEnvironment = "private_sim" | "owned_table" | "api_permitted";
export type JsonSchema = JSONSchemaType<unknown>;

export interface AgentModelConfig {
  name: string;
  provider: AgentProvider;
  modelId: string;
  persona: string;
  promptTemplate: string;
}

export interface AgentPersonaOverrideConfig {
  description?: string;
  promptTemplate?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  styleHints?: Record<string, unknown>;
}

export interface AgentCostPolicyConfig {
  maxTokensDecision: number;
  maxTokensDay: number;
  maxLatencyMs: number;
  consecutiveFailureThreshold: number;
  recoveryHands: number;
}

export interface AgentCircuitBreakerConfig {
  consecutiveFailureThreshold: number;
  cooldownHands: number;
  minCooldownMs?: number;
}

export interface BotConfig {
  compliance: {
    gameType: GameType;
    blinds: { small: number; big: number; ante?: number };
    allowedEnvironments: AllowedEnvironment[];
    siteAllowlist: string[];
  };
  vision: {
    layoutPack: string;
    dpiCalibration: number;
    confidenceThreshold: number;
    occlusionThreshold: number;
  };
  gto: {
    cachePath: string;
    subgameBudgetMs: number;
    deepStackThreshold: number;
  };
  agents: {
    models: AgentModelConfig[];
    timeoutMs: number;
    outputSchema: JsonSchema;
    weightStorePath?: string;
    costPolicy: AgentCostPolicyConfig;
    circuitBreaker: AgentCircuitBreakerConfig;
    personaOverrides?: Record<string, AgentPersonaOverrideConfig>;
  };
  strategy: {
    alphaGTO: number;
    betSizingSets: { preflop: number[]; flop: number[]; turn: number[]; river: number[] };
    divergenceThresholdPP: number;
  };
  execution: {
    enabled: boolean;
    mode: ExecutionMode;
    verifyActions: boolean;
    maxRetries: number;
    verificationTimeoutMs: number;
    simulatorEndpoint?: string;
    researchUI?: {
      allowlist: string[];
      prohibitedSites: string[];
      requireBuildFlag: boolean;
    };
  };
  safety: {
    bankrollLimit: number;
    sessionLimit: number;
    panicStopConfidenceThreshold: number;
    panicStopConsecutiveFrames: number;
  };
  logging: {
    enabled: boolean;
    outputDir: string;
    sessionPrefix?: string;
    flushIntervalMs: number;
    maxFileSizeMb: number;
    retentionDays: number;
    exportFormats: Array<"json" | "acpc">;
    redaction: {
      enabled: boolean;
      fields: Array<"playerNames" | "ids" | "ipAddresses" | "reasoning">;
    };
    metrics: {
      enabled: boolean;
      windowHands: number;
    };
  };
  monitoring: {
    health: HealthMonitoringConfig;
  };
}

export interface HealthMonitoringConfig {
  intervalMs: number;
  degradedThresholds: {
    visionConfidenceMin: number;
    solverLatencyMs: number;
    executorFailureRate: number;
  };
  safeMode: {
    enabled: boolean;
    autoExitSeconds?: number;
  };
  panicStop: {
    visionConfidenceFrames: number;
    minConfidence: number;
    riskGuardAutoTrip: boolean;
  };
  dashboard: {
    enabled: boolean;
    port: number;
    authToken?: string;
  };
}
