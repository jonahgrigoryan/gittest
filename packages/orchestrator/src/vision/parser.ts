import type { VisionOutput, ParserConfig, ParsedGameState } from '../../../shared/src/vision/parser-types';
import type { GameState, Position, Card, Action } from '../../../shared/src/types';
import { shouldTriggerSafeAction, selectSafeAction } from '../safety/safe-action';
import { detectForcedAction } from '../safety/forced-actions';

export class GameStateParser {
  constructor(private config: ParserConfig) {}

  parse(visionOutput: VisionOutput, previousState?: GameState): ParsedGameState {
    const parseErrors: string[] = [];
    const missingElements: string[] = [];
    const inferredValues: Record<string, any> = {};

    try {
      // Parse cards
      const holeCards = this.parseCards(visionOutput.cards.holeCards);
      const communityCards = this.parseCards(visionOutput.cards.communityCards);

      // Parse stacks
      const players = this.parseStacks(visionOutput.stacks);

      // Parse positions
      const positions = this.inferPositions(visionOutput);

      // Build base game state
      const gameState: GameState = {
        handId: `vision_${visionOutput.timestamp}`,
        gameType: 'NLHE_6max', // Default assumption
        blinds: { small: 5, big: 10 }, // Default blinds
        positions,
        players,
        communityCards,
        pot: visionOutput.pot.amount,
        street: this.inferStreet(communityCards),
        actionHistory: [], // Empty for now
        legalActions: [], // Will be computed later
        confidence: {
          overall: this.computeOverallConfidence(visionOutput),
          perElement: this.extractElementConfidences(visionOutput)
        },
        latency: visionOutput.latency.total
      };

      // Add hero's hole cards if detected
      const heroPosition = positions.hero;
      if (heroPosition && players.has(heroPosition)) {
        const heroPlayer = players.get(heroPosition)!;
        heroPlayer.holeCards = holeCards;
      }

      return {
        ...gameState,
        parseErrors,
        missingElements,
        inferredValues
      };

    } catch (error) {
      parseErrors.push(`Parser error: ${error}`);
      // Return minimal fallback state
      return this.createFallbackState(visionOutput, parseErrors, missingElements, inferredValues);
    }
  }

  parseWithSafety(visionOutput: VisionOutput, config: ParserConfig): ParsedGameState {
    const parsedState = this.parse(visionOutput);

    // First check for forced actions (highest priority)
    const forcedAction = detectForcedAction(parsedState, parsedState.positions.hero);
    if (forcedAction) {
      parsedState.recommendedAction = forcedAction;
      return parsedState;
    }

    // Then check if SafeAction should be triggered
    const shouldTrigger = shouldTriggerSafeAction(parsedState, config);

    if (shouldTrigger) {
      parsedState.recommendedAction = selectSafeAction(parsedState);
      parsedState.safeActionTriggered = true;
    }

    return parsedState;
  }

  private parseCards(cards: Array<{rank: string, suit: string}>): Card[] {
    return cards.map(c => ({
      rank: c.rank as any, // Type assertion - assume valid
      suit: c.suit as any
    }));
  }

  private parseStacks(stacks: Map<string, {amount: number, confidence: number}>): Map<Position, {stack: number, holeCards?: Card[]}> {
    const players = new Map<Position, {stack: number, holeCards?: Card[]}>();

    for (const [pos, stackData] of stacks.entries()) {
      players.set(pos as Position, {
        stack: stackData.amount
      });
    }

    return players;
  }

  private inferPositions(visionOutput: VisionOutput): GameState['positions'] {
    // Simple position inference - button position from vision
    const button = visionOutput.buttons.dealer as Position;
    const hero = 'HERO' as Position; // Assume hero position

    // For now, create basic position mapping
    return {
      hero,
      button,
      smallBlind: 'SB' as Position,
      bigBlind: 'BB' as Position
    };
  }

  private inferStreet(communityCards: Card[]): GameState['street'] {
    if (communityCards.length === 0) return 'preflop';
    if (communityCards.length === 3) return 'flop';
    if (communityCards.length === 4) return 'turn';
    if (communityCards.length === 5) return 'river';
    return 'preflop'; // fallback
  }

  private computeOverallConfidence(visionOutput: VisionOutput): number {
    const confidences = [
      visionOutput.cards.confidence,
      visionOutput.pot.confidence,
      visionOutput.buttons.confidence,
      visionOutput.positions.confidence
    ];

    // Add stack confidences
    for (const stackData of visionOutput.stacks.values()) {
      confidences.push(stackData.confidence);
    }

    // Return geometric mean
    const product = confidences.reduce((acc, conf) => acc * conf, 1);
    return Math.pow(product, 1 / confidences.length);
  }

  private extractElementConfidences(visionOutput: VisionOutput): Map<string, number> {
    const confidences = new Map<string, number>();

    confidences.set('cards', visionOutput.cards.confidence);
    confidences.set('pot', visionOutput.pot.confidence);
    confidences.set('buttons', visionOutput.buttons.confidence);
    confidences.set('positions', visionOutput.positions.confidence);

    for (const [pos, stackData] of visionOutput.stacks.entries()) {
      confidences.set(`stack_${pos}`, stackData.confidence);
    }

    return confidences;
  }

  private shouldTriggerSafeAction(state: ParsedGameState, config: ParserConfig): boolean {
    const overallConfidence = state.confidence.overall;
    const confidenceThreshold = config.confidenceThreshold || 0.995;
    const occlusionThreshold = config.occlusionThreshold || 0.05;

    // Check confidence threshold
    if (overallConfidence < confidenceThreshold) {
      return true;
    }

    // Check occlusion (placeholder - would need occlusion data)
    // if (some_occlusion > occlusionThreshold) return true;

    // Check for parse errors
    if (state.parseErrors.length > 0) {
      return true;
    }

    return false;
  }

  private selectSafeAction(state: ParsedGameState): Action {
    // Preflop: check if possible, else fold
    // Postflop: check if possible, else fold
    // Never raise in safe mode

    const checkAction: Action = {
      type: 'check',
      position: state.positions.hero,
      street: state.street
    };

    const foldAction: Action = {
      type: 'fold',
      position: state.positions.hero,
      street: state.street
    };

    // For now, always return fold as safe action
    // In production, would check legal actions
    return foldAction;
  }

  private createFallbackState(
    visionOutput: VisionOutput,
    parseErrors: string[],
    missingElements: string[],
    inferredValues: Record<string, any>
  ): ParsedGameState {
    return {
      handId: `vision_fallback_${visionOutput.timestamp}`,
      gameType: 'NLHE_6max',
      blinds: { small: 5, big: 10 },
      positions: {
        hero: 'HERO' as Position,
        button: 'BTN' as Position,
        smallBlind: 'SB' as Position,
        bigBlind: 'BB' as Position
      },
      players: new Map(),
      communityCards: [],
      pot: 0,
      street: 'preflop',
      actionHistory: [],
      legalActions: [],
      confidence: {
        overall: 0,
        perElement: new Map()
      },
      latency: visionOutput.latency.total,
      parseErrors,
      missingElements,
      inferredValues
    };
  }
}