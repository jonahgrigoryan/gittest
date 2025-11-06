import { performance } from "node:perf_hooks";
import type { AgentProvider } from "@poker-bot/shared/src/config/types";
import type {
  AgentTransport,
  TransportRequest,
  TransportResponse,
  TokenUsage,
  CostQuote
} from "../types";

export interface BaseAgentTransportOptions {
  id: string;
  modelId: string;
  provider: AgentProvider;
  maxRetries?: number;
  retryDelayMs?: number;
  backoffMultiplier?: number;
  costPer1kTokensUsd?: number;
}

export class TransportError extends Error {
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, options: { retryable?: boolean; status?: number; cause?: unknown } = {}) {
    super(message);
    this.name = "TransportError";
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    if (options.cause) {
      // @ts-expect-error cause is supported in modern runtimes
      this.cause = options.cause;
    }
  }
}

export abstract class BaseAgentTransport implements AgentTransport {
  readonly id: string;
  readonly modelId: string;
  readonly provider: AgentProvider;
  readonly supportsStreaming?: boolean;

  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly backoffMultiplier: number;
  private readonly costPer1kTokensUsd: number;

  protected constructor(options: BaseAgentTransportOptions) {
    this.id = options.id;
    this.modelId = options.modelId;
    this.provider = options.provider;
    this.maxRetries = Math.max(0, options.maxRetries ?? 1);
    this.retryDelayMs = Math.max(25, options.retryDelayMs ?? 150);
    this.backoffMultiplier = Math.max(1, options.backoffMultiplier ?? 2);
    this.costPer1kTokensUsd = Math.max(0, options.costPer1kTokensUsd ?? 0.002);
  }

  async invoke(payload: TransportRequest, signal: AbortSignal): Promise<TransportResponse> {
    if (signal.aborted) {
      throw createAbortError(signal.reason);
    }

    let attempt = 0;
    let delayMs = this.retryDelayMs;
    let lastError: unknown;

    while (attempt <= this.maxRetries) {
      try {
        const start = performance.now();
        const response = await this.performRequest(payload, signal);
        const latencyMs = response.latencyMs ?? Math.round(performance.now() - start);
        const tokenUsage = response.tokenUsage ?? defaultTokenUsage();
        return { ...response, latencyMs, tokenUsage };
      } catch (error) {
        if (!this.shouldRetry(error, signal) || attempt === this.maxRetries) {
          throw error;
        }
        lastError = error;
        await this.sleep(delayMs);
        delayMs *= this.backoffMultiplier;
        attempt += 1;
      }
    }

    throw lastError ?? new TransportError("Unknown transport failure", { retryable: false });
  }

  estimateCost(usage: TokenUsage): CostQuote {
    const estimatedCostUsd = (usage.totalTokens / 1000) * this.costPer1kTokensUsd;
    return {
      estimatedCostUsd,
      withinBudget: true
    };
  }

  protected abstract performRequest(payload: TransportRequest, signal: AbortSignal): Promise<TransportResponse>;

  protected shouldRetry(error: unknown, signal: AbortSignal): boolean {
    if (signal.aborted) {
      return false;
    }
    if (error instanceof TransportError) {
      return error.retryable;
    }
    if (typeof error === "object" && error !== null) {
      // Node fetch abort errors expose name/message
      const name = (error as { name?: string }).name;
      if (name === "AbortError") {
        return false;
      }
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

function defaultTokenUsage(): TokenUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  };
}

function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  const error = new Error(typeof reason === "string" ? reason : "Aborted");
  error.name = "AbortError";
  return error;
}
