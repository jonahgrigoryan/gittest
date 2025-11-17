#!/usr/bin/env node
import path from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { config, EvaluationRunConfig, StrategyDecision } from "@poker-bot/shared";
import { createConfigManager } from "@poker-bot/shared";
import { OfflineSmokeRunner, OfflineSuiteRunner } from "../runner/offline";
import { ShadowModeRunner } from "../runner/shadow";
import { ABTestRunner } from "../runner/abTest";
import type { DecisionProvider, DecisionRequestContext } from "../runner/harness";
import { createPipelineDecisionProvider } from "../providers/pipeline";

class RandomDecisionProvider implements DecisionProvider {
  async nextDecision(handId: string, context: DecisionRequestContext): Promise<StrategyDecision> {
    const actionType = context.rng() > 0.5 ? "call" : "fold";
    const amount = actionType === "call" ? context.bigBlind : undefined;
    return {
      action: {
        type: actionType,
        amount,
        position: "BTN",
        street: "preflop"
      },
      reasoning: {
        gtoRecommendation: new Map(),
        agentRecommendation: new Map(),
        blendedDistribution: new Map(),
        alpha: 0.5,
        divergence: 0,
        riskCheckPassed: true,
        sizingQuantized: false
      },
      timing: { gtoTime: 5, agentTime: 5, synthesisTime: 2, totalTime: 12 },
      metadata: {
        rngSeed: Number.parseInt(handId.replace(/[^0-9]/g, ""), 10) || 0,
        configSnapshot: { alphaGTO: 0.5 }
      }
    } as StrategyDecision;
  }
}

const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), "../../config/bot/default.bot.json");

interface SmokeArgs {
  config?: string;
  opponent?: string[];
  hands?: number;
  seed?: number;
  runId?: string;
  metricsDir?: string;
  random?: boolean;
}

interface ShadowArgs {
  config?: string;
  session?: string;
  file?: string;
  hands?: number;
  resultsDir?: string;
  runId?: string;
}

interface AbTestArgs {
  variantA: string;
  variantB: string;
  opponent?: string[];
  hands?: number;
  seed?: number;
  runId?: string;
  metricsDir?: string;
}

function resolveConfigPath(configPath?: string): string {
  if (!configPath) {
    return DEFAULT_CONFIG_PATH;
  }
  return path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);
}

function normalizeOpponents(input: string[] | undefined, fallback: string[]): string[] {
  if (!input || input.length === 0) {
    return fallback;
  }
  return input
    .flatMap(entry => entry.split(","))
    .map(value => value.trim())
    .filter(Boolean);
}

function resolveMetricsDir(dir?: string): string | undefined {
  if (!dir) {
    return undefined;
  }
  return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
}

yargs(hideBin(process.argv))
  .command<SmokeArgs>(
    "smoke",
    "Run offline smoke evaluation",
    builder =>
      builder
        .option("config", { type: "string", describe: "Path to bot config" })
        .option("hands", { type: "number", describe: "Number of hands to simulate" })
        .option("opponent", { type: "array", string: true, describe: "Opponent ids" })
        .option("seed", { type: "number", describe: "RNG seed" })
        .option("runId", { type: "string", describe: "Override run id" })
        .option("metricsDir", { type: "string", describe: "Override metrics output directory" })
        .option("random", { type: "boolean", default: false, describe: "Use random policy" }),
    async args => {
      const configPath = resolveConfigPath(args.config);
      const configManager = await createConfigManager(configPath);
      const evaluationConfig = configManager.get<config.BotConfig["evaluation"]>("evaluation");
      const opponents = normalizeOpponents(args.opponent as string[] | undefined, evaluationConfig.smoke.opponents);
      const maxHands = args.hands ?? evaluationConfig.smoke.maxHands;
      const seed = args.seed ?? evaluationConfig.smoke.seed ?? Date.now();
      const runId = args.runId ?? `smoke-${Date.now()}`;
      const decisionProvider = args.random
        ? new RandomDecisionProvider()
        : await createPipelineDecisionProvider({ configManager, sessionId: runId });
      const runner = new OfflineSmokeRunner({
        decisionProvider,
        rngSeed: seed,
        metricsDir: resolveMetricsDir(args.metricsDir)
      });
      const config: EvaluationRunConfig = {
        mode: "offline_smoke",
        opponents,
        maxHands,
        seed
      };
      const report = await runner.run({ config, runId });
      console.log(JSON.stringify(report, null, 2));
    }
  )
  .command<SmokeArgs>(
    "offline",
    "Run full offline evaluation suite",
    builder =>
      builder
        .option("config", { type: "string", describe: "Path to bot config" })
        .option("hands", { type: "number", describe: "Total hands to simulate" })
        .option("opponent", { type: "array", string: true, describe: "Opponent ids" })
        .option("seed", { type: "number", describe: "RNG seed" })
        .option("runId", { type: "string", describe: "Override run id" })
        .option("metricsDir", { type: "string", describe: "Override metrics output directory" }),
    async args => {
      const configPath = resolveConfigPath(args.config);
      const configManager = await createConfigManager(configPath);
      const evaluationConfig = configManager.get<config.BotConfig["evaluation"]>("evaluation");
      const defaultOpponents = Object.keys(evaluationConfig.opponents ?? {});
      const opponents = normalizeOpponents(
        args.opponent as string[] | undefined,
        defaultOpponents.length ? defaultOpponents : evaluationConfig.smoke.opponents
      );
      const maxHands = args.hands ?? evaluationConfig.offline.maxHands;
      const seed = args.seed ?? Date.now();
      const runId = args.runId ?? `offline-${Date.now()}`;
      const decisionProvider = await createPipelineDecisionProvider({ configManager, sessionId: runId });
      const runner = new OfflineSuiteRunner({
        decisionProvider,
        rngSeed: seed,
        metricsDir: resolveMetricsDir(args.metricsDir)
      });
      const config: EvaluationRunConfig = {
        mode: "offline_full",
        opponents,
        maxHands,
        seed
      };
      const report = await runner.run({ config, runId });
      console.log(JSON.stringify(report, null, 2));
    }
  )
  .command<ShadowArgs>(
    "shadow",
    "Run shadow evaluation using recorded session",
    builder =>
      builder
        .option("config", { type: "string", describe: "Path to bot config" })
        .option("session", { type: "string", describe: "Session identifier" })
        .option("file", { type: "string", describe: "Explicit hand_records.jsonl path" })
        .option("hands", { type: "number", describe: "Max hands to consume" })
        .option("resultsDir", { type: "string", describe: "Override results root" })
        .option("runId", { type: "string", describe: "Override run id" }),
    async args => {
      if (!args.session && !args.file) {
        throw new Error("Provide either --session or --file");
      }
      const configPath = resolveConfigPath(args.config);
      const configManager = await createConfigManager(configPath);
      const evaluationConfig = configManager.get<config.BotConfig["evaluation"]>("evaluation");
      const sessionsRoot = resolveMetricsDir(args.resultsDir) ??
        path.resolve(process.cwd(), evaluationConfig.shadow.defaultResultsDir);
      const runId = args.runId ?? `shadow-${Date.now()}`;
      const runner = new ShadowModeRunner({
        sessionsRoot,
        sessionId: args.session,
        filePath: args.file ? path.resolve(process.cwd(), args.file) : undefined
      });
      const config: EvaluationRunConfig = {
        mode: "shadow",
        opponents: [args.session ?? "recorded"],
        maxHands: args.hands ?? evaluationConfig.offline.checkpointHands
      };
      const report = await runner.run({ config, runId });
      console.log(JSON.stringify(report, null, 2));
    }
  )
  .command<AbTestArgs>(
    "ab-test",
    "Run A/B test against two bot configs",
    builder =>
      builder
        .option("variantA", { type: "string", demandOption: true, describe: "Config for variant A" })
        .option("variantB", { type: "string", demandOption: true, describe: "Config for variant B" })
        .option("opponent", { type: "array", string: true, describe: "Opponent ids" })
        .option("hands", { type: "number", describe: "Total hands" })
        .option("seed", { type: "number", describe: "RNG seed" })
        .option("runId", { type: "string", describe: "Override run id" })
        .option("metricsDir", { type: "string", describe: "Override metrics output directory" }),
    async args => {
      const runId = args.runId ?? `ab-${Date.now()}`;
      const [configManagerA, configManagerB] = await Promise.all([
        createConfigManager(resolveConfigPath(args.variantA)),
        createConfigManager(resolveConfigPath(args.variantB))
      ]);
      const evaluationConfig = configManagerA.get<config.BotConfig["evaluation"]>("evaluation");
      const opponents = normalizeOpponents(
        args.opponent as string[] | undefined,
        evaluationConfig.smoke.opponents
      );
      const maxHands = args.hands ?? evaluationConfig.abTest.maxHands;
      const seed = args.seed ?? Date.now();
      const [providerA, providerB] = await Promise.all([
        createPipelineDecisionProvider({ configManager: configManagerA, sessionId: `${runId}-A` }),
        createPipelineDecisionProvider({ configManager: configManagerB, sessionId: `${runId}-B` })
      ]);
      const metricsDir = resolveMetricsDir(args.metricsDir);
      const runner = new ABTestRunner(
        { decisionProvider: providerA, rngSeed: seed, metricsDir },
        { decisionProvider: providerB, rngSeed: seed + 1, metricsDir }
      );
      const config: EvaluationRunConfig = {
        mode: "ab_test",
        opponents,
        maxHands,
        seed
      };
      const report = await runner.run({ config, runId });
      console.log(JSON.stringify(report, null, 2));
    }
  )
  .demandCommand()
  .help()
  .strict()
  .parse();
