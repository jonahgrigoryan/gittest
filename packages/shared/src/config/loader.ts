import fs from "fs";
import path from "path";
import Ajv2020 from "ajv/dist/2020";
import type { BotConfig, ValidationResult } from "./types";

const defaultSchemaPath = path.resolve(__dirname, "../../../../config/schema/bot-config.schema.json");

/**
 * Validates config and returns structured result without throwing.
 * @param config - Configuration object to validate
 * @param schemaFilePath - Path to JSON schema file
 * @returns ValidationResult with valid flag and optional errors
 */
export function validateConfig(config: unknown, schemaFilePath: string = defaultSchemaPath): ValidationResult {
  const schemaRaw = fs.readFileSync(schemaFilePath, "utf-8");
  const schema = JSON.parse(schemaRaw);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validateFn = ajv.compile(schema);
  const valid = validateFn(config);
  if (!valid) {
    const errors = validateFn.errors?.map(err => `${err.instancePath} ${err.message}`) || [];
    return { valid: false, errors };
  }
  return { valid: true };
}

/**
 * Validates config and throws on validation failure (for backward compatibility).
 * @param config - Configuration object to validate
 * @param schemaFilePath - Path to JSON schema file
 */
export function validate(config: unknown, schemaFilePath: string = defaultSchemaPath): asserts config is BotConfig {
  const schemaRaw = fs.readFileSync(schemaFilePath, "utf-8");
  const schema = JSON.parse(schemaRaw);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validateFn = ajv.compile(schema);
  const valid = validateFn(config);
  if (!valid) {
    const msg = ajv.errorsText(validateFn.errors, { separator: "\n" });
    throw new Error(`Config validation failed:\n${msg}`);
  }
}

export function loadConfig(filePath: string, schemaFilePath: string = defaultSchemaPath): BotConfig {
  const raw = fs.readFileSync(filePath, "utf-8");
  const cfg = JSON.parse(raw);
  validate(cfg, schemaFilePath);
  return cfg as BotConfig;
}
