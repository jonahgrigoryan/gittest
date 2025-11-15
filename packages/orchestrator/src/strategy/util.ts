import type { Action, ActionKey, GameState, Position, Street } from "@poker-bot/shared";

export interface ParsedActionKey {
  ok: true;
  key: ActionKey;
  action: Action;
}

export interface ParsedActionKeyError {
  ok: false;
  key: ActionKey;
  reason: string;
}

export type ParsedActionKeyResult = ParsedActionKey | ParsedActionKeyError;

/**
 * Decode an ActionKey produced by createActionKey into an Action.
 *
 * Format (see @poker-bot/shared/src/types.ts::createActionKey):
 *   `${street}:${position}:${type}:${amountPart}`
 * where:
 *   - street in {"preflop","flop","turn","river"}
 *   - position in Position
 *   - type in {"fold","check","call","raise"}
 *   - amountPart is "-" or fixed-point number (toFixed(2))
 */
export function parseActionKeyToAction(key: ActionKey): ParsedActionKeyResult {
  if (!key || typeof key !== "string") {
    return { ok: false, key, reason: "empty_or_non_string" };
  }

  const parts = key.split(":");
  if (parts.length !== 4) {
    return { ok: false, key, reason: "invalid_format" };
  }

  const [streetRaw, positionRaw, typeRaw, amountRaw] = parts;
  const street = streetRaw as Street;
  const position = positionRaw as Position;
  const type = typeRaw as Action["type"];

  if (!isValidStreet(street)) {
    return { ok: false, key, reason: "invalid_street" };
  }
  if (!isValidPosition(position)) {
    return { ok: false, key, reason: "invalid_position" };
  }
  if (!isValidType(type)) {
    return { ok: false, key, reason: "invalid_type" };
  }

  let amount: number | undefined;
  if (amountRaw !== "-" && amountRaw !== "") {
    const parsed = Number(amountRaw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { ok: false, key, reason: "invalid_amount" };
    }
    amount = parsed;
  }

  const action: Action = { type, position, street, amount };
  return { ok: true, key, action };
}

/**
 * Validate that a decoded Action is legal in the given GameState.
 * Returns a discriminated result so callers can delegate to centralized fallbacks.
 */
export function validateActionAgainstState(
  candidate: Action,
  state: GameState
): ParsedActionKeyResult {
  if (!state.legalActions || state.legalActions.length === 0) {
    return {
      ok: false,
      key: "",
      reason: "no_legal_actions"
    };
  }

  const match = state.legalActions.some(legal => {
    if (legal.type !== candidate.type) return false;
    if (legal.position !== candidate.position || legal.street !== candidate.street) return false;

    if (candidate.type === "raise" || candidate.type === "call") {
      const expected = typeof legal.amount === "number" ? legal.amount : undefined;
      const actual = candidate.amount;
      if (expected === undefined && actual === undefined) return true;
      if (expected === undefined || actual === undefined) return false;
      return Math.abs(expected - actual) < 1e-6;
    }

    return true;
  });

  if (!match) {
    return {
      ok: false,
      key: "",
      reason: "not_in_legal_actions"
    };
  }

  return {
    ok: true,
    key: "",
    action: candidate
  };
}

function isValidStreet(street: Street): boolean {
  return street === "preflop" || street === "flop" || street === "turn" || street === "river";
}

function isValidPosition(position: Position): boolean {
  switch (position) {
    case "BTN":
    case "SB":
    case "BB":
    case "UTG":
    case "MP":
    case "CO":
      return true;
    default:
      return false;
  }
}

function isValidType(type: Action["type"]): boolean {
  return type === "fold" || type === "check" || type === "call" || type === "raise";
}

/**
 * Given a GTOSolution ActionKey and current GameState, attempt to reconstruct
 * a legal Action. Returns a ParsedActionKeyResult used by higher-level
 * components (selector/engine) to decide on fallbacks instead of throwing.
 */
export function decodeAndValidateActionKey(
  key: ActionKey,
  state: GameState
): ParsedActionKeyResult {
  const parsed = parseActionKeyToAction(key);
  if (!parsed.ok) {
    return parsed;
  }
  const validated = validateActionAgainstState(parsed.action, state);
  if (!validated.ok) {
    return {
      ok: false,
      key,
      reason: validated.reason
    };
  }
  return {
    ok: true,
    key,
    action: parsed.action
  };
}
