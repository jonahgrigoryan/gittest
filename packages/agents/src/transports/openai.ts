import type { AgentProvider } from "@poker-bot/shared/src/config/types";
import type { TransportFinishReason, TransportRequest, TransportResponse, TokenUsage } from "../types";
import { BaseAgentTransport, type BaseAgentTransportOptions, TransportError } from "./base";

export interface OpenAITransportOptions extends Omit<BaseAgentTransportOptions, "provider"> {
  apiKey: string;
  provider?: AgentProvider;
  baseUrl?: string;
  completionPath?: string;
  organization?: string;
  project?: string;
  userAgent?: string;
}

export class OpenAITransport extends BaseAgentTransport {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly completionPath: string;
  private readonly organization?: string;
  private readonly project?: string;
  private readonly userAgent: string;

  constructor(options: OpenAITransportOptions) {
    super({
      ...options,
      provider: options.provider ?? "openai"
    });

    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.completionPath = options.completionPath ?? "/chat/completions";
    this.organization = options.organization;
    this.project = options.project;
    this.userAgent = options.userAgent ?? "poker-bot-agents/0.0.1";
  }

  protected async performRequest(payload: TransportRequest, signal: AbortSignal): Promise<TransportResponse> {
    if (typeof fetch !== "function") {
      throw new TransportError("Global fetch is not available", { retryable: false });
    }

    const url = `${this.baseUrl}${this.completionPath}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": this.userAgent
    };

    if (this.organization) {
      headers["OpenAI-Organization"] = this.organization;
    }
    if (this.project) {
      headers["OpenAI-Project"] = this.project;
    }

    const body = JSON.stringify({
      model: this.modelId,
      messages: buildMessages(payload),
      max_tokens: payload.maxTokens,
      temperature: payload.temperature,
      top_p: payload.topP ?? 1,
      stop: payload.stopSequences && payload.stopSequences.length > 0 ? payload.stopSequences : undefined
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal
      });
    } catch (error) {
      throw new TransportError("OpenAI request failed", { retryable: true, cause: error });
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const errorBody = await safeReadBody(response);
      throw new TransportError(
        `OpenAI request failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
        { retryable, status: response.status }
      );
    }

    const json = (await safeParseJson(response)) as OpenAIChatCompletion;
    const choice = json.choices?.[0];
    if (!choice?.message?.content) {
      throw new TransportError("OpenAI response missing content", { retryable: false, status: response.status });
    }

    const tokenUsage = normalizeUsage(json.usage);
    const finishReason = mapFinishReason(choice.finish_reason);

    return {
      agentId: payload.agentId,
      personaId: payload.personaId,
      raw: choice.message.content.trim(),
      latencyMs: json.latency_ms ?? 0,
      tokenUsage,
      finishReason,
      statusCode: response.status
    };
  }
}

interface OpenAIChatCompletion {
  id: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  latency_ms?: number;
}

function buildMessages(payload: TransportRequest) {
  const messages = [] as Array<{ role: string; content: string }>;
  if (payload.systemPrompt) {
    messages.push({ role: "system", content: payload.systemPrompt });
  }
  messages.push({ role: "user", content: payload.prompt });
  return messages;
}

function normalizeUsage(usage?: OpenAIChatCompletion["usage"]): TokenUsage {
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

function mapFinishReason(reason?: string | null): TransportFinishReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "content_filter":
      return "error";
    case "tool_calls":
      return "stop";
    default:
      return "error";
  }
}

async function safeParseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new TransportError("Failed to parse OpenAI response", { retryable: false, status: response.status, cause: error });
  }
}

async function safeReadBody(response: Response): Promise<string | null> {
  try {
    return await response.text();
  } catch {
    return null;
  }
}
