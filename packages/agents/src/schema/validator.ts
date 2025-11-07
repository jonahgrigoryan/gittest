import Ajv from "ajv";
import type { ValidateFunction } from "ajv";
import type { JsonSchema } from "@poker-bot/shared/src/config/types";
import type { AgentOutput, ValidationError, ValidationResult, TokenUsage } from "../types";

export interface AgentSchemaValidatorOptions {
  verbose?: boolean;
  logger?: (message: string) => void;
}

export interface ValidationContext {
  agentId: string;
  personaId: string;
  raw: string;
  latencyMs: number;
  tokenUsage: TokenUsage;
  costUsd?: number;
}

export class AgentSchemaValidator {
  private readonly validateFn: ValidateFunction;
  private readonly verbose: boolean;
  private readonly logger?: (message: string) => void;

  constructor(schema: JsonSchema, options: AgentSchemaValidatorOptions = {}) {
    const ajv = new Ajv({ allErrors: true, strict: true, removeAdditional: false, useDefaults: false });
    this.validateFn = ajv.compile(schema);
    this.verbose = options.verbose ?? process.env.LOG_VERBOSE_AGENTS === "1";
    this.logger = options.logger;
  }

  validate(context: ValidationContext): ValidationResult {
    const { raw } = context;
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const message = `Failed to parse agent response JSON: ${(error as Error).message}`;
      this.log(message);
      return {
        ok: false,
        raw,
        latencyMs: context.latencyMs,
        error: buildError(message)
      };
    }

    const valid = this.validateFn(parsed);
    if (!valid) {
      const schemaErrors = (this.validateFn.errors ?? []).map(err => `${err.instancePath || "."} ${err.message ?? "validation error"}`);
      const message = `Agent response failed schema validation: ${schemaErrors.join("; ")}`;
      this.log(message, schemaErrors);
      return {
        ok: false,
        raw,
        latencyMs: context.latencyMs,
        error: buildError(message, schemaErrors)
      };
    }

    const data = buildAgentOutput(context, parsed as Record<string, unknown>);
    return { ok: true, data };
  }

  private log(message: string, details?: string[]): void {
    if (!this.verbose || !this.logger) {
      return;
    }
    if (details && details.length > 0) {
      this.logger(`${message} (${details.join(", ")})`);
    } else {
      this.logger(message);
    }
  }
}

function buildError(message: string, schemaErrors?: string[]): ValidationError {
  return {
    message,
    schemaErrors
  };
}

function buildAgentOutput(
  context: ValidationContext,
  payload: Record<string, unknown>
): AgentOutput {
  const action = payload.action as AgentOutput["action"];
  const confidence = typeof payload.confidence === "number" ? payload.confidence : 0;
  const sizing = typeof payload.sizing === "number" ? payload.sizing : undefined;
  const reasoning = typeof payload.reasoning === "string" ? payload.reasoning : "";

  return {
    agentId: context.agentId,
    personaId: context.personaId,
    action,
    confidence,
    sizing,
    reasoning,
    latencyMs: context.latencyMs,
    tokenUsage: context.tokenUsage,
    costUsd: context.costUsd,
    raw: context.raw
  };
}
