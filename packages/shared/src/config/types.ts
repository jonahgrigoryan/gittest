import type { JSONSchemaType } from "ajv";

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export type GameType = "HU_NLHE" | "NLHE_6max";
export type AgentProvider = "openai" | "anthropic" | "local";
export type ExecutionMode = "simulator" | "api" | "research_ui";
export type AllowedEnvironment = "private_sim" | "owned_table" | "api_permitted";
export type JsonSchema = JSONSchemaType<unknown>;

export interface AgentModelConfig {
  name: string;
  provider: AgentProvider;
  modelId: string;
  persona: string;
  promptTemplate: string;
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
  };
  strategy: {
    alphaGTO: number;
    betSizingSets: { preflop: number[]; flop: number[]; turn: number[]; river: number[] };
    divergenceThresholdPP: number;
  };
  execution: {
    mode: ExecutionMode;
    researchUIAllowlist?: string[];
  };
  safety: {
    bankrollLimit: number;
    sessionLimit: number;
    panicStopConfidenceThreshold: number;
    panicStopConsecutiveFrames: number;
  };
  logging: {
    retentionDays: number;
    exportFormats: Array<"json" | "acpc">;
  };
}
