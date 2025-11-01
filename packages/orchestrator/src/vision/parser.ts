import type { GameState, Card, Position, Action, Street } from '@poker-bot/shared/src/types';
import type { VisionOutput } from '@poker-bot/shared/src/vision/types';
import type { ParsedGameState, ParserConfig } from './parser-types';
import type { BotConfig } from '@poker-bot/shared/src/config/types';
import { shouldTriggerSafeAction, selectSafeAction } from '../safety/safe-action';

export class GameStateParser {
  private config: ParserConfig;

  constructor(config: ParserConfig) {
    this.config = config;
  }

  parse(visionOutput: VisionOutput, previousState?: GameState): ParsedGameState {
    const errors: string[] = [];
    const missing: string[] = [];
    const inferred: Record<string, unknown> = {};

    // Parse cards
    const holeCards = this.parseCards(visionOutput.cards.holeCards);
    const communityCards = this.parseCards(visionOutput.cards.communityCards);

    // Determine street from community cards
    const street = this.inferStreet(communityCards);

    // Parse stacks
    const players = this.parseStacks(visionOutput.stacks);

    // Parse pot
    const pot = this.parsePot(visionOutput.pot);

    // Parse button position
    const button = visionOutput.buttons.dealer as Position;

    // Infer positions
    const positions = this.inferPositions(button, players.size);

    // Parse action history (empty for now, would come from separate tracking)
    const actionHistory: Action[] = [];

    // Calculate legal actions
    const legalActions = this.computeLegalActions({
      street,
      pot,
      players,
      button,
      actionHistory,
    } as GameState);

    // Calculate overall confidence
    const overallConf = this.computeOverallConfidence(visionOutput);

    const state: ParsedGameState = {
      handId: this.generateHandId(),
      gameType: players.size === 2 ? 'HU_NLHE' : 'NLHE_6max',
      blinds: { small: 1, big: 2 }, // Would come from config
      positions: {
        hero: positions.hero,
        button: button,
        smallBlind: positions.smallBlind,
        bigBlind: positions.bigBlind,
      },
      players,
      communityCards,
      pot,
      street,
      actionHistory,
      legalActions,
      confidence: {
        overall: overallConf,
        perElement: this.extractPerElementConfidence(visionOutput),
      },
      latency: visionOutput.latency.total,
      parseErrors: errors,
      missingElements: missing,
      inferredValues: inferred,
    };

    return state;
  }

  parseCards(cards: Card[]): Card[] {
    return cards.filter(card => {
      // Filter out invalid cards
      const validRank = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'].includes(card.rank);
      const validSuit = ['h', 'd', 'c', 's'].includes(card.suit);
      return validRank && validSuit;
    });
  }

  parseStacks(stacks: Map<Position, { amount: number; confidence: number }>): Map<Position, { stack: number; holeCards?: Card[] }> {
    const players = new Map<Position, { stack: number; holeCards?: Card[] }>();
    
    for (const [position, data] of stacks.entries()) {
      if (data.confidence >= this.config.confidenceThreshold) {
        players.set(position, { stack: data.amount });
      }
    }

    return players;
  }

  parsePot(pot: { amount: number; confidence: number }): number {
    if (pot.confidence >= this.config.confidenceThreshold) {
      return pot.amount;
    }
    return 0;
  }

  inferStreet(communityCards: Card[]): Street {
    if (communityCards.length === 0) return 'preflop';
    if (communityCards.length === 3) return 'flop';
    if (communityCards.length === 4) return 'turn';
    if (communityCards.length === 5) return 'river';
    return 'preflop';
  }

  inferPositions(button: Position, numPlayers: number): {
    hero: Position;
    smallBlind: Position;
    bigBlind: Position;
  } {
    // Simple inference: hero is typically at bottom center (BB in 6max)
    const hero = 'BB' as Position;
    
    // Calculate SB/BB from button
    const positionOrder: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'MP', 'CO'];
    const btnIdx = positionOrder.indexOf(button);
    const sbIdx = (btnIdx + 1) % positionOrder.length;
    const bbIdx = (btnIdx + 2) % positionOrder.length;

    return {
      hero,
      smallBlind: positionOrder[sbIdx],
      bigBlind: positionOrder[bbIdx],
    };
  }

  computeLegalActions(state: Partial<GameState>): Action[] {
    const actions: Action[] = [];
    const street = state.street || 'preflop';
    const heroPos = state.positions?.hero || 'BB';

    // Simplified legal actions
    actions.push({ type: 'fold', position: heroPos, street });
    actions.push({ type: 'check', position: heroPos, street });
    actions.push({ type: 'call', position: heroPos, street });
    actions.push({ type: 'raise', position: heroPos, street, amount: 10 });

    return actions;
  }

  computeOverallConfidence(visionOutput: VisionOutput): number {
    const confidences: number[] = [
      visionOutput.cards.confidence,
      visionOutput.pot.confidence,
      visionOutput.buttons.confidence,
      visionOutput.positions.confidence,
    ];

    // Average confidence
    const sum = confidences.reduce((a, b) => a + b, 0);
    return sum / confidences.length;
  }

  extractPerElementConfidence(visionOutput: VisionOutput): Map<string, number> {
    const confidences = new Map<string, number>();
    
    confidences.set('cards', visionOutput.cards.confidence);
    confidences.set('pot', visionOutput.pot.confidence);
    confidences.set('buttons', visionOutput.buttons.confidence);
    confidences.set('positions', visionOutput.positions.confidence);

    for (const [pos, data] of visionOutput.stacks.entries()) {
      confidences.set(`stack_${pos}`, data.confidence);
    }

    return confidences;
  }

  generateHandId(): string {
    return `hand_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  parseWithSafety(visionOutput: VisionOutput, config: BotConfig): ParsedGameState {
    const state = this.parse(visionOutput);
    
    // Check if SafeAction should trigger
    const shouldTrigger = shouldTriggerSafeAction(state, config);
    
    if (shouldTrigger) {
      state.safeActionTriggered = true;
      state.recommendedAction = selectSafeAction(state);
    }

    return state;
  }
}
