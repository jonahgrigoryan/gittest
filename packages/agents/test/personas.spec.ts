import { describe, it, expect } from "vitest";
import type { GameState, Card, Rank, Suit } from "@poker-bot/shared";
import {
  createPersonaTemplates,
  DEFAULT_PERSONA_IDS,
  estimatePromptTokens
} from "../src/personas";
import type { PromptContext } from "../src";

const SAMPLE_STATE: GameState = {
  handId: "H-123",
  gameType: "NLHE_6max",
  blinds: { small: 1, big: 2 },
  positions: { hero: "CO", button: "BTN", smallBlind: "SB", bigBlind: "BB" },
  players: new Map([
    ["BTN", { stack: 120 }],
    ["CO", { stack: 95, holeCards: makeCards(["As", "Kd"]) }],
    ["SB", { stack: 40 }],
    ["BB", { stack: 60 }]
  ]),
  communityCards: makeCards(["7h", "5d", "2c"]),
  pot: 15.5,
  street: "flop",
  actionHistory: [
    { type: "raise", amount: 6, position: "BTN", street: "preflop" },
    { type: "call", amount: 6, position: "CO", street: "preflop" },
    { type: "call", amount: 5, position: "BB", street: "preflop" }
  ],
  legalActions: [
    { type: "fold", position: "CO", street: "flop" },
    { type: "call", amount: 6, position: "CO", street: "flop" },
    { type: "raise", amount: 18, position: "CO", street: "flop" }
  ],
  confidence: { overall: 0.998, perElement: new Map([["board", 0.997]]) },
  latency: 120
};

const SAMPLE_CONTEXT: PromptContext = {
  requestId: "test-context",
  timeBudgetMs: 1200,
  solverSummary: {
    recommendedAction: "call",
    rationale: "Range retains equity versus likely c-bet",
    equities: { call: 0.45, raise: 0.52 },
    confidence: 0.72
  }
};

describe("persona templates", () => {
  it("registers all default personas", () => {
    const personas = createPersonaTemplates();
    expect(Object.keys(personas)).toEqual(DEFAULT_PERSONA_IDS);
  });

  it("produces prompts under token budget and includes legal actions", () => {
    const personas = createPersonaTemplates();
    for (const persona of Object.values(personas)) {
      const promptA = persona.prompt(SAMPLE_STATE, SAMPLE_CONTEXT);
      const promptB = persona.prompt(SAMPLE_STATE, SAMPLE_CONTEXT);

      expect(promptA).toContain("Legal actions");
      expect(promptA).toContain("CO:raise@18");
      expect(promptA).toContain("Solver summary");
      expect(promptA).toEqual(promptB);
      expect(estimatePromptTokens(promptA)).toBeLessThan(550);
    }
  });

  it("applies config overrides to persona metadata", () => {
    const overrides = {
      gto_purist: {
        maxTokens: 512,
        temperature: 0.1,
        promptTemplate: "You are a custom postflop equilibrium auditor.",
        styleHints: {
          guidelines: ["Always cite nut advantage swings."],
          tone: "stoic"
        }
      }
    } as const;

    const personas = createPersonaTemplates(overrides);
    const persona = personas.gto_purist;
    expect(persona.maxTokens).toBe(512);
    expect(persona.temperature).toBe(0.1);

    const prompt = persona.prompt(SAMPLE_STATE, SAMPLE_CONTEXT);
    expect(prompt.startsWith(overrides.gto_purist.promptTemplate)).toBe(true);
    expect(prompt).toContain("cite nut advantage swings");
  });
});

function makeCards(codes: string[]): Card[] {
  return codes.map(code => ({
    rank: code[0] as Rank,
    suit: code[1] as Suit
  }));
}
