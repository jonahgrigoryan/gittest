import type { Action, Card, Position } from "@poker-bot/shared";
import type { config, vision } from "@poker-bot/shared";

const POSITIONS: Position[] = ["BTN", "SB", "BB", "UTG", "MP", "CO"];

export function createBotConfig(overrides: Partial<config.BotConfig> = {}): config.BotConfig {
  const base: config.BotConfig = {
    compliance: {
      gameType: "NLHE_6max",
      blinds: { small: 1, big: 2 },
      allowedEnvironments: ["private_sim"],
      siteAllowlist: []
    },
    vision: {
      layoutPack: "",
      dpiCalibration: 1,
      confidenceThreshold: 0.995,
      occlusionThreshold: 0.05
    },
    gto: {
      cachePath: "",
      subgameBudgetMs: 0,
      deepStackThreshold: 0
    },
    agents: {
      models: [],
      timeoutMs: 0,
      outputSchema: {}
    },
    strategy: {
      alphaGTO: 0.5,
      betSizingSets: { preflop: [], flop: [], turn: [], river: [] },
      divergenceThresholdPP: 0
    },
    execution: {
      mode: "simulator"
    },
    safety: {
      bankrollLimit: 0,
      sessionLimit: 0,
      panicStopConfidenceThreshold: 0.99,
      panicStopConsecutiveFrames: 3
    },
    logging: {
      retentionDays: 7,
      exportFormats: ["json"]
    }
  };

  return {
    ...base,
    ...overrides,
    compliance: { ...base.compliance, ...overrides.compliance },
    vision: { ...base.vision, ...overrides.vision },
    gto: { ...base.gto, ...overrides.gto },
    agents: { ...base.agents, ...overrides.agents },
    strategy: { ...base.strategy, ...overrides.strategy },
    execution: { ...base.execution, ...overrides.execution },
    safety: { ...base.safety, ...overrides.safety },
    logging: { ...base.logging, ...overrides.logging }
  };
}

export function createParsedState(
  overrides: Partial<vision.ParsedGameState> = {},
  legalActionsOverride?: Action[]
): vision.ParsedGameState {
  const players = new Map<Position, { stack: number; holeCards?: Card[] }>();
  POSITIONS.forEach(position => {
    players.set(position, { stack: 100 });
  });

  const baseState: vision.ParsedGameState = {
    handId: "hand-001",
    gameType: "NLHE_6max",
    blinds: { small: 1, big: 2 },
    positions: {
      hero: "SB",
      button: "BTN",
      smallBlind: "SB",
      bigBlind: "BB"
    },
    players,
    communityCards: [],
    pot: 0,
    street: "preflop",
    actionHistory: [],
    legalActions:
      legalActionsOverride ?? [
        { type: "check", position: "SB", street: "preflop" },
        { type: "fold", position: "SB", street: "preflop" }
      ],
    confidence: { overall: 1, perElement: new Map() },
    latency: 0,
    parseErrors: [],
    missingElements: [],
    inferredValues: {}
  };

  const mergedPlayers = overrides.players ? new Map(overrides.players) : baseState.players;
  const mergedConfidence = overrides.confidence
    ? { ...baseState.confidence, ...overrides.confidence, perElement: overrides.confidence.perElement ?? baseState.confidence.perElement }
    : baseState.confidence;

  return {
    ...baseState,
    ...overrides,
    players: mergedPlayers,
    actionHistory: overrides.actionHistory ?? baseState.actionHistory,
    legalActions: overrides.legalActions ?? baseState.legalActions,
    confidence: mergedConfidence,
    parseErrors: overrides.parseErrors ?? [...baseState.parseErrors],
    missingElements: overrides.missingElements ?? [...baseState.missingElements],
    inferredValues: { ...baseState.inferredValues, ...overrides.inferredValues }
  };
}
