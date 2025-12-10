import type { EnvService } from "./schema";
import { ENV_SCHEMAS } from "./schema";

type EnvSource = Record<string, string | undefined>;

const PLACEHOLDER_PATTERNS = [/CHANGE_ME/i, /REPLACE_ME/i, /^<.*>$/];

export class EnvValidationError extends Error {
  constructor(service: EnvService, public readonly missing: string[]) {
    super(
      `[env] Missing required environment variables for ${service}: ${missing
        .sort()
        .join(", ")}`
    );
  }
}

export function getMissingEnvVars(service: EnvService, source: EnvSource = process.env): string[] {
  const schema = ENV_SCHEMAS[service];
  if (!schema) {
    return [];
  }

  return schema.required.filter(key => {
    const value = source[key];
    if (value === undefined || value === null) {
      return true;
    }

    if (schema.allowEmpty?.includes(key)) {
      return false;
    }

    const trimmed = value.trim();
    if (!trimmed.length) {
      return true;
    }

    return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(trimmed));
  });
}

export function assertEnvVars(service: EnvService, source: EnvSource = process.env): void {
  const missing = getMissingEnvVars(service, source);
  if (missing.length) {
    throw new EnvValidationError(service, missing);
  }
}

