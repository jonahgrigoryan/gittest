import type { AgentPersonaOverrideConfig } from "@poker-bot/shared/src/config/types";
import type { PersonaTemplate } from "../types";
import { buildPrompt } from "./promptBuilder";

export interface PersonaSeed {
  id: string;
  description: string;
  maxTokens: number;
  temperature: number;
  topP?: number;
  stopSequences?: string[];
  styleHints: Record<string, unknown>;
}

export function instantiatePersona(
  seed: PersonaSeed,
  override?: AgentPersonaOverrideConfig
): PersonaTemplate {
  const mergedStyleHints = {
    ...seed.styleHints,
    ...(override?.styleHints ?? {})
  };

  const persona: PersonaTemplate = {
    id: seed.id,
    description: override?.description ?? seed.description,
    styleHints: mergedStyleHints,
    maxTokens: override?.maxTokens ?? seed.maxTokens,
    temperature: override?.temperature ?? seed.temperature,
    topP: override?.topP ?? seed.topP,
    stopSequences: override?.stopSequences ?? seed.stopSequences,
    prompt: () => ""
  };

  const explicitTemplate = override?.promptTemplate;
  persona.prompt = (state, context) => buildPrompt(state, persona, context, explicitTemplate);

  return persona;
}
