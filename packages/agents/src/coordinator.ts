import path from "node:path";
import type { GameState, ActionType } from "@poker-bot/shared";
import type { ConfigurationManager } from "@poker-bot/shared/src/config/manager";
import type {
  AgentModelConfig,
  JsonSchema,
  AgentPersonaOverrideConfig,
  AgentCircuitBreakerConfig
} from "@poker-bot/shared/src/config/types";
import type {
  AgentCoordinator,
  AgentOutput,
  AgentQueryOptions,
  AggregatedAgentOutput,
  AgentFailure,
  AgentDefinition,
  PromptContext,
  TimeBudgetTracker,
  PersonaTemplate,
  AgentTransport,
  TransportResponse,
  CostQuote,
  WeightSnapshot,
  BrierSample,
  CostBudgetPolicy
} from "./types";
import { createPersonaTemplates } from "./personas";
import { AgentSchemaValidator } from "./schema";
import { executeAgentTasks, AgentTimeoutError, type AgentTaskRunner } from "./coordinator/concurrency";
import {
  AgentCoordinatorError,
  PersonaNotFoundError,
  TransportUnavailableError,
  ValidationFailureError
} from "./errors";
import {
  computeWeights,
  createDefaultSnapshot,
  updateWeightSnapshot
} from "./weighting/engine";
import { loadWeightSnapshot, saveWeightSnapshot } from "./weighting/storage";
import {
  computeWeightedDistribution,
  calculateConsensus,
  determineWinningAction,
  buildCostSummary
} from "./coordinator/aggregation";
import { CostGuard } from "./policy/costGuard";
import { CircuitBreaker } from "./policy/circuitBreaker";
import { AgentTelemetryLogger } from "./telemetry/logger";

export interface CoordinatorLogger {
  debug?(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}

export interface AgentCoordinatorOptions {
  configManager: ConfigurationManager;
  transports: Map<string, AgentTransport>;
  personaOverrides?: Record<string, AgentPersonaOverrideConfig>;
  personaTemplates?: Record<string, PersonaTemplate>;
  schema?: JsonSchema;
  validator?: AgentSchemaValidator;
  timeBudgetTracker?: TimeBudgetTracker;
  logger?: CoordinatorLogger;
  now?: () => number;
}

interface AgentTaskContext {
  definition: AgentDefinition;
  persona: PersonaTemplate;
  transport: AgentTransport;
}

export class AgentCoordinatorService implements AgentCoordinator {
  private readonly configManager: ConfigurationManager;
  private readonly transports: Map<string, AgentTransport>;
  private readonly logger?: CoordinatorLogger;
  private readonly timeBudgetTracker?: TimeBudgetTracker;
  private readonly now: () => number;

  private personaTemplates: Record<string, PersonaTemplate>;
  private schemaValidator: AgentSchemaValidator;
  private weightSnapshot: WeightSnapshot;
  private weightStorePath: string | null;
  private weightsLoaded = false;
  private weightLoadPromise: Promise<void> | null = null;
  private costGuard: CostGuard;
  private circuitBreaker: CircuitBreaker;
  private telemetry: AgentTelemetryLogger;
  private readonly costPolicy: CostBudgetPolicy;

  constructor(options: AgentCoordinatorOptions) {
    this.configManager = options.configManager;
    this.transports = options.transports;
    this.logger = options.logger;
    this.timeBudgetTracker = options.timeBudgetTracker;
    this.now = options.now ?? (() => Date.now());

    this.personaTemplates = options.personaTemplates ?? this.buildPersonaTemplates();
    const schema = options.schema ?? this.configManager.get<JsonSchema>("agents.outputSchema");
    this.schemaValidator = options.validator ?? new AgentSchemaValidator(schema, {
      logger: message => this.logger?.warn?.(message)
    });
    this.weightStorePath = this.resolveWeightStorePath();
    this.weightSnapshot = createDefaultSnapshot();
    this.costPolicy = this.configManager.get<CostBudgetPolicy>("agents.costPolicy");
    this.costGuard = new CostGuard(this.costPolicy);
    this.circuitBreaker = new CircuitBreaker(
      this.configManager.get<AgentCircuitBreakerConfig>("agents.circuitBreaker")
    );
    this.telemetry = new AgentTelemetryLogger(process.env.LOG_VERBOSE_AGENTS === "1");
  }

  async query(state: GameState, context: PromptContext, options?: AgentQueryOptions): Promise<AggregatedAgentOutput> {
    const start = this.now();
    this.weightStorePath = this.resolveWeightStorePath();
    this.circuitBreaker.stepCooldown();
    if (this.circuitBreaker.isCoolingDown(start)) {
      const distribution = new Map<ActionType, number>();
      const costSummary = buildCostSummary([]);
      const breakerState = this.circuitBreaker.getState();
      const costGuardState = this.costGuard.getState();
      this.telemetry.log({
        requestId: context.requestId,
        outputs: [],
        failures: [],
        distribution,
        costSummary,
        circuitBreaker: breakerState,
        costGuardState
      });
      return {
        outputs: [],
        normalizedActions: distribution,
        consensus: 0,
        winningAction: null,
        budgetUsedMs: 0,
        circuitBreakerTripped: true,
        notes: "Circuit breaker cooling down",
        droppedAgents: [],
        costSummary,
        startedAt: start,
        completedAt: start
      };
    }

    const agentConfigs = this.getAgentConfigs();
    const personaTemplates = this.refreshPersonasIfNeeded();
    const timeoutMs = this.configManager.get<number>("agents.timeoutMs");

    const candidates = this.prepareCandidates(agentConfigs, personaTemplates, state, context, options);
    const failures: AgentFailure[] = [...candidates.failures];
    const tasks = candidates.tasks;

    const sharedBudgetMs = Math.min(context.timeBudgetMs, options?.budgetOverrideMs ?? context.timeBudgetMs, timeoutMs);
    const perAgentTimeoutMs = Math.min(timeoutMs, sharedBudgetMs);

    const executionResults = await executeAgentTasks(tasks.map(task => task.runner), {
      perAgentTimeoutMs,
      sharedBudgetMs,
      signal: options?.signal,
      timeBudgetTracker: this.timeBudgetTracker
    });

    const outputs: AgentOutput[] = [];

    executionResults.forEach((result, index) => {
      const taskCtx = tasks[index];
      if (!taskCtx) {
        return;
      }

      if (result.status === "fulfilled" && result.value) {
        const { response, costQuote } = result.value;
        const validation = this.schemaValidator.validate({
          agentId: taskCtx.definition.id,
          personaId: taskCtx.persona.id,
          raw: response.raw,
          latencyMs: response.latencyMs,
          tokenUsage: response.tokenUsage,
          costUsd: costQuote.estimatedCostUsd
        });

        if (validation.ok) {
          const output = validation.data;
          output.metadata = {
            ...output.metadata,
            finishReason: response.finishReason,
            statusCode: response.statusCode
          };
          outputs.push(output);
        } else {
          failures.push({
            agentId: taskCtx.definition.id,
            personaId: taskCtx.persona.id,
            reason: "validation",
            latencyMs: response.latencyMs,
            raw: response.raw,
            details: validation.error.message
          });
        }
      } else if (result.status === "fulfilled") {
        failures.push({
          agentId: taskCtx.definition.id,
          personaId: taskCtx.persona.id,
          reason: "unknown",
          latencyMs: result.allottedMs,
          details: "Agent task fulfilled without payload"
        });
      } else {
        const failure = this.mapFailure(taskCtx, result.reason, result.allottedMs, result.aborted);
        failures.push(failure);
      }
    });

    await this.ensureWeightsLoaded();
    const weightMap = computeWeights(outputs, this.weightSnapshot);
    for (const output of outputs) {
      const weightValue = weightMap.get(output.agentId) ?? this.weightSnapshot.defaultWeight;
      output.metadata = {
        ...output.metadata,
        weight: weightValue
      };
    }

    const normalizedActions = computeWeightedDistribution(outputs, weightMap);
    const consensus = calculateConsensus(normalizedActions);
    const winningAction = determineWinningAction(normalizedActions);
    const end = this.now();

    const costSummary = buildCostSummary(outputs);
    const elapsed = end - start;
    const costEvaluation = this.costGuard.evaluate(costSummary, elapsed);
    let circuitBreakerTripped = false;

    if (!costEvaluation.allowed) {
      failures.push({
        agentId: "cost_guard",
        personaId: "system",
        reason: "cost_guard",
        latencyMs: elapsed,
        details: costEvaluation.reason
      });
      this.costGuard.recordFailure();
      const breakerState = this.circuitBreaker.registerFailure("cost_guard", end);
      circuitBreakerTripped =
        breakerState.consecutiveFailures >= this.costPolicy.consecutiveFailureThreshold ||
        this.circuitBreaker.isCoolingDown(end);
    } else {
      this.costGuard.recordDecision(costSummary);
      if (outputs.length > 0) {
        this.costGuard.recordSuccess();
        this.circuitBreaker.registerSuccess();
      } else if (failures.length > 0) {
        this.costGuard.recordFailure();
        const failureReason = failures[0].reason ?? "unknown";
        const breakerState = this.circuitBreaker.registerFailure(failureReason, end);
        circuitBreakerTripped =
          breakerState.consecutiveFailures >= this.costPolicy.consecutiveFailureThreshold ||
          this.circuitBreaker.isCoolingDown(end);
      }
    }

    const breakerState = this.circuitBreaker.getState();
    const costGuardState = this.costGuard.getState();

    this.telemetry.log({
      requestId: context.requestId,
      outputs,
      failures,
      distribution: normalizedActions,
      costSummary,
      circuitBreaker: breakerState,
      costGuardState
    });

    let notes: string | undefined = outputs.length === 0 ? "No valid agent responses" : undefined;
    if (!costEvaluation.allowed) {
      notes = `Cost guard triggered: ${costEvaluation.reason}`;
    } else if (circuitBreakerTripped) {
      notes = notes ?? "Circuit breaker threshold reached";
    }

    return {
      outputs,
      normalizedActions,
      consensus,
      winningAction,
      budgetUsedMs: elapsed,
      circuitBreakerTripped,
      notes,
      droppedAgents: failures.length > 0 ? failures : undefined,
      costSummary,
      startedAt: start,
      completedAt: end
    };
  }

  async preload(): Promise<void> {
    this.personaTemplates = this.buildPersonaTemplates();
    const schema = this.configManager.get<JsonSchema>("agents.outputSchema");
    this.schemaValidator = new AgentSchemaValidator(schema, {
      logger: message => this.logger?.warn?.(message)
    });
    this.weightStorePath = this.resolveWeightStorePath();
    await this.ensureWeightsLoaded();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  private getAgentConfigs(): AgentModelConfig[] {
    try {
      return this.configManager.get<AgentModelConfig[]>("agents.models");
    } catch (error) {
      this.logger?.error?.("Failed to load agent model configuration", { error });
      throw new AgentCoordinatorError("Failed to load agent model configuration", { cause: error });
    }
  }

  private async ensureWeightsLoaded(): Promise<void> {
    if (this.weightsLoaded) {
      return;
    }

    if (!this.weightLoadPromise) {
      this.weightLoadPromise = loadWeightSnapshot(this.weightStorePath)
        .then(snapshot => {
          this.weightSnapshot = snapshot;
          this.weightsLoaded = true;
        })
        .catch(error => {
          this.logger?.warn?.("Failed to load weight snapshot", { error });
          this.weightSnapshot = createDefaultSnapshot();
          this.weightsLoaded = true;
        });
    }

    await this.weightLoadPromise;
  }

  private refreshPersonasIfNeeded(): Record<string, PersonaTemplate> {
    return (this.personaTemplates = this.buildPersonaTemplates());
  }

  private buildPersonaTemplates(): Record<string, PersonaTemplate> {
    let overrides: Record<string, AgentPersonaOverrideConfig> | undefined;
    try {
      overrides = this.configManager.get<Record<string, AgentPersonaOverrideConfig> | undefined>(
        "agents.personaOverrides"
      );
    } catch {
      overrides = undefined;
    }
    return createPersonaTemplates(overrides ?? {});
  }

  private prepareCandidates(
    configs: AgentModelConfig[],
    personas: Record<string, PersonaTemplate>,
    gameState: GameState,
    promptContext: PromptContext,
    options?: AgentQueryOptions
  ): { tasks: AgentTaskContextWithRunner[]; failures: AgentFailure[] } {
    const tasks: AgentTaskContextWithRunner[] = [];
    const failures: AgentFailure[] = [];
    const allowedPersonas = options?.forcePersonas ? new Set(options.forcePersonas) : null;

    for (const config of configs) {
      const definition: AgentDefinition = {
        id: config.name,
        modelId: config.modelId,
        personaId: config.persona,
        description: config.promptTemplate,
        enabled: true
      };

      if (allowedPersonas && !allowedPersonas.has(definition.personaId)) {
        continue;
      }

      const persona = personas[definition.personaId];
      if (!persona) {
        failures.push({
          agentId: definition.id,
          personaId: definition.personaId,
          reason: "disabled",
          latencyMs: 0,
          details: new PersonaNotFoundError(definition.personaId).message
        });
        continue;
      }

      const transport = this.transports.get(definition.modelId);
      if (!transport) {
        failures.push({
          agentId: definition.id,
          personaId: definition.personaId,
          reason: "transport",
          latencyMs: 0,
          details: new TransportUnavailableError(definition.modelId).message
        });
        continue;
      }

      const taskContext: AgentTaskContext = { definition, persona, transport };
      tasks.push({
        ...taskContext,
        runner: this.createTaskRunner(taskContext, gameState, promptContext)
      });
    }

    return { tasks, failures };
  }

  private createTaskRunner(
    context: AgentTaskContext,
    gameState: GameState,
    promptContext: PromptContext
  ): AgentTaskRunner<TransportResponseWithCost> {
    return {
      agentId: context.definition.id,
      run: async (signal, allottedMs) => {
        const personaContext: PromptContext = {
          ...promptContext,
          timeBudgetMs: Math.min(promptContext.timeBudgetMs, allottedMs)
        };
        const prompt = context.persona.prompt(gameState, personaContext);
        const request = this.buildTransportRequest(context, prompt, allottedMs);
        const response = await context.transport.invoke(request, signal);
        return {
          response,
          costQuote: context.transport.estimateCost(response.tokenUsage)
        };
      }
    };
  }

  private buildTransportRequest(context: AgentTaskContext, prompt: string, allottedMs: number) {
    return {
      agentId: context.definition.id,
      personaId: context.persona.id,
      prompt,
      systemPrompt: context.definition.description,
      maxTokens: context.persona.maxTokens,
      temperature: context.persona.temperature,
      topP: context.persona.topP,
      stopSequences: context.persona.stopSequences,
      metadata: {
        allottedMs
      }
    };
  }

  private mapFailure(
    context: AgentTaskContext,
    reason: unknown,
    allottedMs: number,
    aborted: boolean
  ): AgentFailure {
    const base: AgentFailure = {
      agentId: context.definition.id,
      personaId: context.persona.id,
      reason: "unknown",
      latencyMs: allottedMs,
      details: reason instanceof Error ? reason.message : String(reason)
    };

    if (reason instanceof AgentCoordinatorError) {
      if (reason instanceof ValidationFailureError) {
        return {
          ...base,
          reason: "validation",
          latencyMs: reason.latencyMs,
          raw: reason.raw
        };
      }
      return { ...base, reason: "transport" };
    }

    if (reason instanceof AgentTimeoutError || aborted) {
      return { ...base, reason: "timeout" };
    }

    if (reason instanceof Error && reason.name === "AbortError") {
      return { ...base, reason: "timeout" };
    }

    if (reason instanceof Error) {
      return { ...base, reason: "transport" };
    }

    return base;
  }

  private resolveWeightStorePath(): string | null {
    const override = process.env.AGENTS_WEIGHT_STORE;
    const configured = this.safeConfigGet<string>("agents.weightStorePath");
    const chosen = override ?? configured;
    if (!chosen) {
      return null;
    }
    return path.isAbsolute(chosen) ? chosen : path.resolve(process.cwd(), chosen);
  }

  private safeConfigGet<T>(key: string): T | undefined {
    try {
      return this.configManager.get<T>(key);
    } catch {
      return undefined;
    }
  }

  async updateWeights(samples: BrierSample[]): Promise<void> {
    if (samples.length === 0) {
      return;
    }
    await this.ensureWeightsLoaded();
    this.weightSnapshot = updateWeightSnapshot(this.weightSnapshot, samples);
    await saveWeightSnapshot(this.weightSnapshot, this.weightStorePath);
  }
}

interface TransportResponseWithCost {
  response: TransportResponse;
  costQuote: CostQuote;
}

interface AgentTaskContextWithRunner extends AgentTaskContext {
  runner: AgentTaskRunner<TransportResponseWithCost>;
}
