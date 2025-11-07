import type { GameState, Action, Card } from "@poker-bot/shared";
import type { PersonaTemplate, PromptContext, SolverSummary } from "../types";

const BASE_GUIDELINES: string[] = [
  "Respond with strictly valid minified JSON (no trailing text).",
  "Select only from the legal actions provided; never invent moves.",
  "Include confidence between 0 and 1, rounded to two decimals.",
  "If analysis is uncertain or budget is nearly exhausted, prefer the lowest variance legal option (typically check or fold)."
];

const RESPONSE_SCHEMA_REMINDER = `{
  "reasoning": "succinct analysis (<=3 sentences)",
  "action": "fold|check|call|raise",
  "sizing": 0.0,
  "confidence": 0.0
}`;

export function buildPrompt(
  state: GameState,
  persona: PersonaTemplate,
  context: PromptContext,
  customTemplate?: string
): string {
  const header = (customTemplate ?? defaultHeader(persona)).trim();
  const guidelines = gatherGuidelines(persona);
  const formattedGuidelines = guidelines
    .map((line, index) => `${index + 1}. ${line}`)
    .join("\n");

  const promptSections = [
    header,
    `Guidelines:\n${formattedGuidelines}`,
    `Game snapshot:\n${formatGameState(state)}`,
    formatSolverSummary(context.solverSummary),
    `Decision metadata: request=${context.requestId}; time_budget_ms=${context.timeBudgetMs}`,
    `Respond with JSON matching:\n${RESPONSE_SCHEMA_REMINDER}`
  ].filter(Boolean);

  return promptSections.join("\n\n");
}

export function estimatePromptTokens(prompt: string): number {
  return prompt
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function defaultHeader(persona: PersonaTemplate): string {
  const tone = readString(persona.styleHints, "tone");
  return `You are ${persona.description}${tone ? ` with a ${tone} tone` : ""}.`;
}

function gatherGuidelines(persona: PersonaTemplate): string[] {
  const personaGuidelines = readStringArray(persona.styleHints, "guidelines");
  const emphasis = readStringArray(persona.styleHints, "emphasis");
  const combined = [...personaGuidelines, ...emphasis, ...BASE_GUIDELINES];

  if (combined.length === BASE_GUIDELINES.length && readString(persona.styleHints, "fallback")) {
    combined.unshift(readString(persona.styleHints, "fallback")!);
  }

  return combined;
}

function formatGameState(state: GameState): string {
  const lines: string[] = [];
  lines.push(`Hand: ${state.handId}`);
  lines.push(`Street: ${state.street} | Pot: ${state.pot.toFixed(2)} | Blinds: ${state.blinds.small}/${state.blinds.big}`);
  lines.push(`Positions: hero=${state.positions.hero}, button=${state.positions.button}`);

  const playerLines = Array.from(state.players.entries())
    .map(([position, info]) => {
      const cards = info.holeCards ? ` | cards=${formatCards(info.holeCards)}` : "";
      return `${position}: stack=${info.stack}${cards}`;
    })
    .join("; ");
  if (playerLines) {
    lines.push(`Stacks: ${playerLines}`);
  }

  if (state.communityCards.length > 0) {
    lines.push(`Board: ${formatCards(state.communityCards)}`);
  }

  if (state.actionHistory.length > 0) {
    const recentActions = state.actionHistory
      .slice(-6)
      .map(formatAction)
      .join(" -> ");
    lines.push(`Recent actions: ${recentActions}`);
  }

  lines.push(`Legal actions: ${state.legalActions.map(formatAction).join(", ")}`);
  lines.push(`Vision confidence: ${state.confidence.overall.toFixed(3)}`);

  return lines.join("\n");
}

function formatSolverSummary(summary?: SolverSummary): string | undefined {
  if (!summary) {
    return undefined;
  }

  const equities = summary.equities
    ? ` equities=${Object.entries(summary.equities)
        .map(([action, equity]) => `${action}:${equity.toFixed(2)}`)
        .join(";")}`
    : "";
  const action = summary.recommendedAction ?? "none";
  const confidence = summary.confidence !== undefined ? ` confidence=${summary.confidence.toFixed(2)}` : "";
  const rationale = summary.rationale ? ` rationale=${summary.rationale}` : "";

  return `Solver summary: action=${action};${equities}${confidence}${rationale}`.trim();
}

function formatCards(cards: Card[]): string {
  return cards.map(card => `${card.rank}${card.suit}`).join(" ");
}

function formatAction(action: Action): string {
  const base = `${action.position}:${action.type}`;
  if (action.amount !== undefined) {
    return `${base}@${action.amount}`;
  }
  return base;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === "string" ? value : undefined;
}

function readStringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source?.[key];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }
  return [];
}
