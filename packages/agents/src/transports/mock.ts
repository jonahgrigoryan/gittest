import type { AgentProvider } from "@poker-bot/shared/src/config/types";
import type {
  AgentTransport,
  TransportRequest,
  TransportResponse,
  TokenUsage,
  CostQuote,
  TransportFinishReason
} from "../types";

export interface MockTransportOptions {
  id?: string;
  modelId?: string;
  provider?: AgentProvider;
  defaultLatencyMs?: number;
  costPerTokenUsd?: number;
}

export interface MockTransportResult {
  payload: TransportRequest;
  signalAborted: boolean;
  attempt: number;
}

export interface MockQueuedResponse {
  raw: string;
  latencyMs?: number;
  finishReason?: TransportFinishReason;
  tokenUsage?: Partial<TokenUsage>;
  statusCode?: number;
  error?: unknown;
}

type MockResponder = (payload: TransportRequest) => Promise<MockQueuedResponse> | MockQueuedResponse;

export class MockTransport implements AgentTransport {
  readonly id: string;
  readonly modelId: string;
  readonly provider: AgentProvider;
  readonly supportsStreaming = false;

  private readonly defaultLatencyMs: number;
  private readonly costPerTokenUsd: number;
  private responders: MockResponder[] = [];
  private readonly history: MockTransportResult[] = [];

  constructor(options: MockTransportOptions = {}) {
    this.id = options.id ?? "mock";
    this.modelId = options.modelId ?? "mock-model";
    this.provider = options.provider ?? "local";
    this.defaultLatencyMs = options.defaultLatencyMs ?? 25;
    this.costPerTokenUsd = options.costPerTokenUsd ?? 0.000002;
  }

  enqueueResponse(response: MockQueuedResponse | MockResponder): void {
    const responder: MockResponder = typeof response === "function" ? response : () => response;
    this.responders.push(responder);
  }

  clearQueue(): void {
    this.responders = [];
  }

  get callHistory(): ReadonlyArray<MockTransportResult> {
    return this.history;
  }

  get pendingResponses(): number {
    return this.responders.length;
  }

  async invoke(payload: TransportRequest, signal: AbortSignal): Promise<TransportResponse> {
    const attempt = this.history.length + 1;
    this.history.push({ payload, signalAborted: signal.aborted, attempt });

    if (signal.aborted) {
      throw signal.reason ?? new Error("Aborted before mock transport execution");
    }

    const responder = this.responders.shift();
    if (!responder) {
      throw new Error("MockTransport received invoke without queued response");
    }

    const result = await responder(payload);
    if (result.error) {
      throw result.error;
    }

    const tokenUsage = normalizeUsage(result.tokenUsage);
    return {
      agentId: payload.agentId,
      personaId: payload.personaId,
      raw: result.raw,
      latencyMs: result.latencyMs ?? this.defaultLatencyMs,
      tokenUsage,
      finishReason: result.finishReason ?? "stop",
      statusCode: result.statusCode
    };
  }

  estimateCost(usage: TokenUsage): CostQuote {
    const estimatedCostUsd = usage.totalTokens * this.costPerTokenUsd;
    return {
      estimatedCostUsd,
      withinBudget: true
    };
  }
}

function normalizeUsage(partial?: Partial<TokenUsage>): TokenUsage {
  const promptTokens = partial?.promptTokens ?? 0;
  const completionTokens = partial?.completionTokens ?? 0;
  const totalTokens = partial?.totalTokens ?? promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}
