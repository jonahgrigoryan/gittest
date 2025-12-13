import type { AgentPersonaOverrideConfig } from "@poker-bot/shared";
import type { PersonaTemplate } from "../types";
import { gtoPuristSeed } from "./gtoPurist";
import { exploitAggressorSeed } from "./exploitAggressor";
import { riskAverseValueSeed } from "./riskAverseValue";
import type { PersonaSeed } from "./seed";
import { instantiatePersona } from "./seed";

export { buildPrompt, estimatePromptTokens } from "./promptBuilder";

const PERSONA_SEEDS: PersonaSeed[] = [gtoPuristSeed, exploitAggressorSeed, riskAverseValueSeed];

export const DEFAULT_PERSONA_IDS = PERSONA_SEEDS.map(seed => seed.id);

export function createPersonaTemplates(
  overrides: Record<string, AgentPersonaOverrideConfig> = {}
): Record<string, PersonaTemplate> {
  const entries = PERSONA_SEEDS.map(seed => {
    const persona = instantiatePersona(seed, overrides[seed.id]);
    return [seed.id, persona] as const;
  });

  return Object.fromEntries(entries);
}

export function createPersonaList(
  overrides: Record<string, AgentPersonaOverrideConfig> = {}
): PersonaTemplate[] {
  return PERSONA_SEEDS.map(seed => instantiatePersona(seed, overrides[seed.id]));
}

export function getPersona(
  id: string,
  overrides: Record<string, AgentPersonaOverrideConfig> = {}
): PersonaTemplate | undefined {
  const seed = PERSONA_SEEDS.find(candidate => candidate.id === id);
  if (!seed) {
    return undefined;
  }
  return instantiatePersona(seed, overrides[id]);
}

export function listPersonaSeeds(): PersonaSeed[] {
  return PERSONA_SEEDS.map(seed => ({ ...seed, styleHints: { ...seed.styleHints } }));
}
