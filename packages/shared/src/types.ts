export enum Suit { C = "C", D = "D", H = "H", S = "S" }
export enum Rank { Two="2", Three="3", Four="4", Five="5", Six="6", Seven="7", Eight="8", Nine="9", Ten="T", Jack="J", Queen="Q", King="K", Ace="A" }
export enum Position { BTN="BTN", SB="SB", BB="BB", UTG="UTG", MP="MP", CO="CO" }
export enum Street { Preflop="PREFLOP", Flop="FLOP", Turn="TURN", River="RIVER" }

export interface Card { rank: Rank; suit: Suit; }
export type ActionType = "fold" | "check" | "call" | "raise";

export interface Action {
  type: ActionType;
  amount?: number;
  position: Position;
  street: Street;
}

export interface RNG {
  seed: string;
  next(): number;
}

export interface GameState {
  street: Street;
  heroPosition: Position;
  board?: Card[];
  pot: number;
  stacks: Record<string, number>;
  confidence?: Record<string, number>;
  latencyMs?: Record<string, number>;
}
