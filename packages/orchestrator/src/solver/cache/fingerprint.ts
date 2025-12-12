import crypto from "node:crypto";
import type { Action, Card, GameState, Street } from "@poker-bot/shared/src/types";
import { calculateEffectiveStack } from "../deep_stack";
import { FINGERPRINT_ALGORITHM } from "./types";

const VERSION_TAG = "v1";
const STACK_BUCKET_SIZE_BB = 5;
const POT_BUCKET_SIZE_BB = 2;
const SPR_BUCKET_SIZE = 0.5;

interface FingerprintComponents {
  version: string;
  street: Street;
  gameType: GameState["gameType"];
  heroPosition: string;
  buttonPosition: string;
  stackBucket: number;
  potBucket: number;
  blinds: { small: number; big: number };
  board: string;
  hole: string;
  actionHistory: string[];
  sprBucket: number;
  algorithm: string;
}

export function computeFingerprint(state: GameState): string {
  const components: FingerprintComponents = {
    version: VERSION_TAG,
    street: state.street,
    gameType: state.gameType,
    heroPosition: state.positions.hero,
    buttonPosition: state.positions.button,
    stackBucket: bucketStacks(state),
    potBucket: bucketPot(state),
    blinds: { small: state.blinds.small, big: state.blinds.big },
    board: bucketBoard(state.communityCards, state.street),
    hole: bucketHoleCards(state),
    actionHistory: bucketActionHistory(state.actionHistory, state.blinds.big),
    sprBucket: bucketSPR(state),
    algorithm: FINGERPRINT_ALGORITHM,
  };

  const serialized = JSON.stringify(components);
  const hash = crypto.createHash("sha256").update(serialized).digest("hex");
  return `${VERSION_TAG}:${hash}`;
}

function bucketStacks(state: GameState): number {
  const effectiveStack = Math.max(0, calculateEffectiveStack(state));
  const bucketed = Math.floor(effectiveStack / STACK_BUCKET_SIZE_BB) * STACK_BUCKET_SIZE_BB;
  return bucketed;
}

function bucketPot(state: GameState): number {
  const bigBlind = Math.max(state.blinds.big, 1);
  const potInBb = state.pot / bigBlind;
  const bucketed = Math.floor(potInBb / POT_BUCKET_SIZE_BB) * POT_BUCKET_SIZE_BB;
  return bucketed;
}

function bucketBoard(cards: Card[], street: Street): string {
  if (street === "preflop" || cards.length === 0) {
    return "none";
  }
  const ranks = cards.map(cardRankValue).sort((a, b) => b - a);
  const suits = cards.map((card) => card.suit);
  const isPaired = new Set(ranks).size !== ranks.length;
  const suitSet = new Set(suits);
  const texture = suitSet.size === 1 ? "monotone" : suitSet.size === 2 ? "two-tone" : "rainbow";
  return `${texture}-${isPaired ? "paired" : "unpaired"}-${ranks.join("-")}`;
}

function bucketHoleCards(state: GameState): string {
  const hero = state.players.get(state.positions.hero);
  const holeCards = hero?.holeCards;
  if (!holeCards || holeCards.length < 2) {
    return "unknown";
  }
  const [first, second] = holeCards;
  const ranks = [cardRankValue(first), cardRankValue(second)].sort((a, b) => b - a);
  const suited = first.suit === second.suit;
  if (first.rank === second.rank) {
    return `pair-${ranks[0]}`;
  }
  return `${ranks.join("-")}-${suited ? "s" : "o"}`;
}

function bucketActionHistory(actions: Action[], bigBlind: number): string[] {
  if (!actions.length) {
    return ["none"];
  }
  return actions.map((action) => {
    const amount = action.amount ?? 0;
    const inBb = bigBlind > 0 ? amount / bigBlind : amount;
    const bucket = Math.round(inBb);
    return `${action.position}-${action.type}-${bucket}`;
  });
}

function bucketSPR(state: GameState): number {
  const bigBlind = Math.max(state.blinds.big, 1);
  const stacks = Array.from(state.players.values()).map((player) => player.stack).filter((stack) => Number.isFinite(stack));
  if (stacks.length === 0) {
    return 0;
  }
  const effectiveStackChips = Math.min(...stacks);
  if (!Number.isFinite(effectiveStackChips) || bigBlind <= 0) {
    return 0;
  }
  const pot = Math.max(state.pot, bigBlind);
  const spr = effectiveStackChips / pot;
  const bucketed = Math.floor(spr / SPR_BUCKET_SIZE) * SPR_BUCKET_SIZE;
  return Number(bucketed.toFixed(2));
}

function cardRankValue(card: Card): number {
  switch (card.rank) {
    case "A":
      return 14;
    case "K":
      return 13;
    case "Q":
      return 12;
    case "J":
      return 11;
    case "T":
      return 10;
    default:
      return Number.parseInt(card.rank, 10);
  }
}
