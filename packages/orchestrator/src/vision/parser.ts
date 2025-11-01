import type {
  VisionOutput,
  ParsedGameState,
  ParserConfig,
} from "@poker-bot/shared/vision";
import type {
  GameState,
  Card,
  Position,
  Street,
  GameType,
  Action,
  BotConfig,
} from "@poker-bot/shared";
import { shouldTriggerSafeAction, selectSafeAction } from "../safety/safe-action";

export class GameStateParser {
  constructor(private config: ParserConfig) {}

  /**
   * Parse VisionOutput into GameState
   */
  parse(
    visionOutput: VisionOutput,
    previousState?: GameState
  ): ParsedGameState {
    const parseErrors: string[] = [];
    const missingElements: string[] = [];
    const inferredValues: Record<string, any> = {};

    // Parse cards
    const holeCards = this.parseCards(
      visionOutput.cards.holeCards,
      parseErrors
    );
    const communityCards = this.parseCards(
      visionOutput.cards.communityCards,
      parseErrors
    );

    // Check card confidence
    if (visionOutput.cards.confidence < this.config.confidenceThreshold) {
      parseErrors.push(
        `Card confidence (${visionOutput.cards.confidence}) below threshold`
      );
    }

    // Parse stacks and build player map
    const players = this.parseStacks(visionOutput.stacks, parseErrors);

    // Parse pot
    const pot = this.parsePot(visionOutput.pot, parseErrors);

    // Determine street from community cards
    const street = this.inferStreet(communityCards);

    // Infer positions (simplified - button is dealer)
    let dealerPos: Position = "BTN";
    try {
      dealerPos = visionOutput.buttons.dealer as Position;
    } catch {
      parseErrors.push("Invalid dealer position");
      missingElements.push("dealer");
    }

    // Build position assignments
    const positions = {
      hero: "BTN" as Position, // Assume hero is button for now
      button: dealerPos,
      smallBlind: "SB" as Position,
      bigBlind: "BB" as Position,
    };

    // Build confidence map
    const confidenceMap = new Map<string, number>();
    confidenceMap.set("cards", visionOutput.cards.confidence);
    confidenceMap.set("pot", visionOutput.pot.confidence);
    confidenceMap.set("buttons", visionOutput.buttons.confidence);
    confidenceMap.set("positions", visionOutput.positions.confidence);

    // Add stack confidences
    for (const [pos, stackData] of visionOutput.stacks) {
      confidenceMap.set(`stack_${pos}`, stackData.confidence);
    }

    // Calculate overall confidence
    const overallConfidence = this.calculateOverallConfidence(confidenceMap);

    // Build base game state
    const gameState: GameState = {
      handId: previousState?.handId || `hand_${Date.now()}`,
      gameType: "NLHE_6max" as GameType,
      blinds: { small: 0.5, big: 1.0 },
      positions,
      players,
      communityCards,
      pot,
      street,
      actionHistory: previousState?.actionHistory || [],
      legalActions: [], // Will be computed later
      confidence: {
        overall: overallConfidence,
        perElement: confidenceMap,
      },
      latency: visionOutput.latency.total,
    };

    // Build parsed state
    const parsedState: ParsedGameState = {
      ...gameState,
      parseErrors,
      missingElements,
      inferredValues,
    };

    return parsedState;
  }

  /**
   * Parse VisionOutput with SafeAction checking
   */
  parseWithSafety(
    visionOutput: VisionOutput,
    botConfig: BotConfig,
    previousState?: GameState
  ): ParsedGameState {
    // First, parse normally
    const parsedState = this.parse(visionOutput, previousState);

    // Check if SafeAction should trigger
    if (shouldTriggerSafeAction(parsedState, botConfig)) {
      parsedState.recommendedAction = selectSafeAction(parsedState);
      parsedState.safeActionTriggered = true;
    }

    return parsedState;
  }

  private parseCards(cards: Card[], errors: string[]): Card[] {
    const validCards: Card[] = [];

    for (const card of cards) {
      if (this.isValidCard(card)) {
        validCards.push(card);
      } else {
        errors.push(`Invalid card: ${JSON.stringify(card)}`);
      }
    }

    return validCards;
  }

  private isValidCard(card: Card): boolean {
    const validRanks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
    const validSuits = ["h", "d", "c", "s"];

    return validRanks.includes(card.rank) && validSuits.includes(card.suit);
  }

  private parseStacks(
    stacks: Map<Position, { amount: number; confidence: number }>,
    errors: string[]
  ): Map<Position, { stack: number; holeCards?: Card[] }> {
    const players = new Map<Position, { stack: number; holeCards?: Card[] }>();

    for (const [pos, stackData] of stacks) {
      if (stackData.confidence < this.config.confidenceThreshold) {
        errors.push(
          `Stack confidence for ${pos} (${stackData.confidence}) below threshold`
        );
      }

      if (stackData.amount >= 0) {
        players.set(pos, { stack: stackData.amount });
      } else {
        errors.push(`Invalid stack amount for ${pos}: ${stackData.amount}`);
      }
    }

    return players;
  }

  private parsePot(
    potData: { amount: number; confidence: number },
    errors: string[]
  ): number {
    if (potData.confidence < this.config.confidenceThreshold) {
      errors.push(`Pot confidence (${potData.confidence}) below threshold`);
    }

    if (potData.amount < 0) {
      errors.push(`Invalid pot amount: ${potData.amount}`);
      return 0;
    }

    return potData.amount;
  }

  private inferStreet(communityCards: Card[]): Street {
    const numCards = communityCards.length;
    if (numCards === 0) return "preflop";
    if (numCards === 3) return "flop";
    if (numCards === 4) return "turn";
    if (numCards === 5) return "river";
    return "preflop"; // Fallback
  }

  private calculateOverallConfidence(
    confidenceMap: Map<string, number>
  ): number {
    const values = Array.from(confidenceMap.values());
    if (values.length === 0) return 0;

    // Use minimum confidence (most conservative)
    return Math.min(...values);
  }
}
