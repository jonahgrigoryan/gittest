import type { BotConfig } from "@poker-bot/shared/src/config/types";
import type { Card, GameState, Position, Street } from "@poker-bot/shared/src/types";
import type { ParserConfig, ParsedGameState, VisionOutput } from "@poker-bot/shared/src/vision";

import { computeLegalActions } from "./legal-actions";
import { StateSyncTracker } from "./state-sync";
import { detectForcedAction } from "../safety/forced-actions";
import { selectSafeAction, shouldTriggerSafeAction } from "../safety/safe-action";

const STREET_BY_COMMUNITY_COUNT: Record<number, Street> = {
  0: "preflop",
  3: "flop",
  4: "turn",
  5: "river"
};

export class GameStateParser {
  private readonly config: ParserConfig;

  private readonly stateSync: StateSyncTracker;

  constructor(config: ParserConfig) {
    this.config = config;
    this.stateSync = new StateSyncTracker();
  }

  parseWithSafety(visionOutput: VisionOutput, botConfig: BotConfig, previousState?: GameState): ParsedGameState {
    const parsed = this.parse(visionOutput, previousState);

    const forcedAction = detectForcedAction(parsed, parsed.positions.hero);
    if (forcedAction) {
      parsed.recommendedAction = forcedAction;
      parsed.safeActionTriggered = true;
      parsed.inferredValues.forcedAction = forcedAction;
      return parsed;
    }

    if (shouldTriggerSafeAction(parsed, botConfig)) {
      parsed.recommendedAction = selectSafeAction(parsed);
      parsed.safeActionTriggered = true;
    }

    return parsed;
  }

  parse(visionOutput: VisionOutput, previousState?: GameState): ParsedGameState {
    const parseErrors: string[] = [];
    const missingElements: string[] = [];
    const inferredValues: Record<string, unknown> = {};
    const perElementConfidence = new Map<string, number>();

    let heroCards = this.parseCards(visionOutput.cards.holeCards);
    if (heroCards.length < 2) {
      if (this.config.enableInference && previousState) {
        const previousHeroCards = previousState.players.get(previousState.positions.hero)?.holeCards;
        if (previousHeroCards && previousHeroCards.length >= 2) {
          heroCards = [...previousHeroCards];
          inferredValues.heroCardsInferred = true;
        } else {
          missingElements.push("heroCards");
        }
      } else {
        missingElements.push("heroCards");
      }
    }
    perElementConfidence.set("cards", visionOutput.cards.confidence ?? 0);

    const communityCards = this.parseCards(visionOutput.cards.communityCards);

    const stackEntries = this.parseStacks(visionOutput.stacks);
    const stacksConfidence = stackEntries.length
      ? stackEntries.reduce((sum, [, value]) => sum + (value.confidence ?? 0), 0) / stackEntries.length
      : 0;
    perElementConfidence.set("stacks", stacksConfidence);

    const players = this.buildPlayerMap(stackEntries);
    const pot = this.parsePot(visionOutput.pot);
    perElementConfidence.set("pot", visionOutput.pot?.confidence ?? 0);

    const buttonPosition = visionOutput.buttons?.dealer ?? previousState?.positions.button ?? "BTN";
    perElementConfidence.set("buttons", visionOutput.buttons?.confidence ?? 0);

    const positionsConfidence = visionOutput.positions?.confidence ?? 0;
    perElementConfidence.set("positions", positionsConfidence);

    const occlusionEntries = this.mapEntries(visionOutput.occlusion);
    const occlusion = Object.fromEntries(occlusionEntries);
    inferredValues.occlusion = occlusion;

    const latency = visionOutput.latency?.total ?? 0;
    inferredValues.latency = visionOutput.latency;

    const communityCount = communityCards.length;
    const street = STREET_BY_COMMUNITY_COUNT[communityCount] ?? previousState?.street ?? "preflop";

    const heroPosition = previousState?.positions.hero ?? this.defaultHeroPosition(buttonPosition);
    const positions = this.derivePositions(heroPosition, buttonPosition);

    const heroInfo = players.get(heroPosition) ?? { stack: 0 };
    heroInfo.holeCards = heroCards;
    players.set(heroPosition, heroInfo);

    const confidenceOverall = this.calculateOverallConfidence(perElementConfidence);

    const baseState: GameState = {
      handId: previousState?.handId ?? String(visionOutput.timestamp),
      gameType: previousState?.gameType ?? "NLHE_6max",
      blinds: previousState?.blinds ?? { small: 0, big: 0 },
      positions,
      players,
      communityCards,
      pot,
      street,
      actionHistory: previousState?.actionHistory ?? [],
      legalActions: [],
      confidence: {
        overall: confidenceOverall,
        perElement: perElementConfidence
      },
      latency
    };

    baseState.legalActions = computeLegalActions(baseState);

    const parsed: ParsedGameState = {
      ...baseState,
      parseErrors,
      missingElements,
      inferredValues
    };

    const syncErrors = this.stateSync.detectInconsistencies(parsed);
    if (syncErrors.length > 0) {
      parsed.parseErrors.push(...syncErrors);
    }

    this.stateSync.addFrame(parsed);
    parsed.inferredValues.consecutiveErrorCount = this.stateSync.getConsecutiveErrorCount();

    return parsed;
  }

  private parseCards(elements: Card[]): Card[] {
    return elements.filter(card => Boolean(card?.rank) && Boolean(card?.suit));
  }

  private parseStacks(
    stacks: VisionOutput["stacks"]
  ): Array<[Position, { amount: number; confidence: number }]> {
    const entries = this.mapEntries(stacks);
    return entries
      .filter(([position]) => this.isPosition(position))
      .map(([position, value]) => [position as Position, value]);
  }

  private buildPlayerMap(
    entries: Array<[Position, { amount: number; confidence: number }]>
  ): Map<Position, { stack: number; holeCards?: Card[] }> {
    const players = new Map<Position, { stack: number; holeCards?: Card[] }>();
    entries.forEach(([position, value]) => {
      players.set(position, { stack: value.amount });
    });
    return players;
  }

  private parsePot(pot: VisionOutput["pot"]): number {
    return pot?.amount ?? 0;
  }

  private calculateOverallConfidence(perElement: Map<string, number>): number {
    const weights: Record<string, number> = {
      cards: 0.5,
      stacks: 0.3,
      pot: 0.2,
      buttons: 0.1,
      positions: 0.1
    };

    let weighted = 0;
    let totalWeight = 0;
    perElement.forEach((confidence, key) => {
      const weight = weights[key] ?? 0.05;
      weighted += Math.max(0, Math.min(confidence, 1)) * weight;
      totalWeight += weight;
    });

    if (totalWeight === 0) {
      return 0;
    }

    return Math.max(0, Math.min(weighted / totalWeight, 1));
  }

  private mapEntries<T>(value: Map<string, T> | Record<string, T> | undefined): Array<[string, T]> {
    if (!value) {
      return [];
    }
    if (value instanceof Map) {
      return Array.from(value.entries());
    }
    return Object.entries(value);
  }

  private defaultHeroPosition(button: Position): Position {
    if (button === "BTN") {
      return "SB";
    }
    if (button === "SB") {
      return "BB";
    }
    return "SB";
  }

  private derivePositions(hero: Position, button: Position): GameState["positions"] {
    const order: Position[] = ["BTN", "SB", "BB", "UTG", "MP", "CO"];
    const buttonIndex = order.indexOf(button);
    const sb = order[(buttonIndex + 1) % order.length];
    const bb = order[(buttonIndex + 2) % order.length];
    return {
      hero,
      button,
      smallBlind: sb,
      bigBlind: bb
    };
  }

  private isPosition(value: string): value is Position {
    return ["BTN", "SB", "BB", "UTG", "MP", "CO"].includes(value);
  }
}
