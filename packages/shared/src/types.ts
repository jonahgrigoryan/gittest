export type Suit = "h" | "d" | "c" | "s";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";
export type Position = "BTN" | "SB" | "BB" | "UTG" | "MP" | "CO";
export type Street = "preflop" | "flop" | "turn" | "river";
export type GameType = "HU_NLHE" | "NLHE_6max";

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type ActionType = "fold" | "check" | "call" | "raise";

export interface Action {
  type: ActionType;
  amount?: number;
  position: Position;
  street: Street;
}

export interface RNG {
  seed: number;
  next(): number;
}

export interface GameState {
  handId: string;
  gameType: GameType;
  blinds: { small: number; big: number; ante?: number };
  positions: {
    hero: Position;
    button: Position;
    smallBlind: Position;
    bigBlind: Position;
  };
  players: Map<Position, { stack: number; holeCards?: Card[] }>;
  communityCards: Card[];
  pot: number;
  street: Street;
  actionHistory: Action[];
  legalActions: Action[];
  confidence: {
    overall: number;
    perElement: Map<string, number>;
  };
  latency: number;
}
