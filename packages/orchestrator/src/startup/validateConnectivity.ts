import type { LayoutPack } from "@poker-bot/shared/src/vision";
import { assertEnvVars } from "@poker-bot/shared/src/env/validator";
import { fetch } from "undici";
import { createSolverClient } from "../solver_client/client";
import { VisionClient } from "../vision/client";

const DEFAULT_TIMEOUT_MS = 5000;

interface ValidateConnectivityOptions {
  solverAddr: string;
  visionServiceUrl: string;
  layoutPack: LayoutPack;
  requireAgentConnectivity: boolean;
  useMockAgents?: boolean;
  logger?: Pick<Console, "info" | "warn" | "error">;
  timeoutMs?: number;
}

interface LlmProbe {
  name: string;
  url: string;
  headers: Record<string, string>;
}

export async function validateStartupConnectivity(
  options: ValidateConnectivityOptions
): Promise<void> {
  if (process.env.ORCH_SKIP_STARTUP_CHECKS === "1") {
    options.logger?.warn?.("Skipping startup connectivity checks (ORCH_SKIP_STARTUP_CHECKS=1).");
    return;
  }

  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  await ensureSolverReady(options.solverAddr, timeout, options.logger);
  await ensureVisionReady(options.visionServiceUrl, options.layoutPack, timeout, options.logger);

  if (options.requireAgentConnectivity) {
    if (options.useMockAgents) {
      options.logger?.info?.("Agent connectivity: using mock mode (AGENTS_USE_MOCK=1)");
    } else {
      assertEnvVars("agents");
      await ensureLlmProvidersReachable(timeout, options.logger);
    }
  }
}

async function ensureSolverReady(
  address: string,
  timeoutMs: number,
  logger?: Pick<Console, "info" | "warn" | "error">
): Promise<void> {
  const client = createSolverClient(address);
  try {
    if (!("waitForReady" in client)) {
      logger?.warn?.("Solver client missing waitForReady implementation; skipping ready check.");
      return;
    }
    await client.waitForReady(timeoutMs);
    logger?.info?.(`Solver ready at ${address}`);
  } catch (error) {
    throw new Error(`Solver connectivity check failed (${address}): ${(error as Error).message}`);
  } finally {
    client.close();
  }
}

async function ensureVisionReady(
  serviceUrl: string,
  layoutPack: LayoutPack,
  timeoutMs: number,
  logger?: Pick<Console, "info" | "warn" | "error">
): Promise<void> {
  const client = new VisionClient(serviceUrl, layoutPack);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    await client.healthCheck();
    logger?.info?.(`Vision service healthy at ${serviceUrl}`);
  } catch (error) {
    throw new Error(`Vision connectivity check failed (${serviceUrl}): ${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
    client.close();
  }
}

async function ensureLlmProvidersReachable(
  timeoutMs: number,
  logger?: Pick<Console, "info" | "warn" | "error">
): Promise<void> {
  const probes = buildLlmProbes();
  if (probes.length === 0) {
    throw new Error("Agent models configured but no LLM API keys were provided.");
  }

  await Promise.all(
    probes.map(async probe => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(probe.url, {
          method: "GET",
          headers: probe.headers,
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        logger?.info?.(`LLM provider reachable: ${probe.name}`);
      } catch (error) {
        throw new Error(`LLM connectivity check failed for ${probe.name}: ${(error as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
    })
  );
}

function buildLlmProbes(): LlmProbe[] {
  const probes: LlmProbe[] = [];
  const openAiKey = process.env.OPENAI_API_KEY;
  if (openAiKey) {
    const base = normalizeBaseUrl(process.env.OPENAI_BASE_URL ?? "https://api.openai.com");
    probes.push({
      name: "openai",
      url: `${base}/v1/models?limit=1`,
      headers: {
        Authorization: `Bearer ${openAiKey}`
      }
    });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const base = normalizeBaseUrl(process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com");
    probes.push({
      name: "anthropic",
      url: `${base}/v1/models`,
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": process.env.ANTHROPIC_VERSION ?? "2023-06-01"
      }
    });
  }

  return probes;
}

function normalizeBaseUrl(input: string): string {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

