import fs from "fs";
import path from "path";
import Ajv2020 from "ajv/dist/2020";
import type { LayoutPack, ValidationResult } from "./types";

const defaultSchemaPath = path.resolve(__dirname, "../../../config/schema/layout-pack.schema.json");

/**
 * Loads and validates a layout pack from JSON file
 * @param filePath - Path to the layout pack JSON file
 * @param schemaFilePath - Path to JSON schema file (optional)
 * @returns Validated LayoutPack object
 * @throws Error if file doesn't exist or validation fails
 */
export function loadLayoutPack(filePath: string, schemaFilePath: string = defaultSchemaPath): LayoutPack {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Layout pack file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  let pack: unknown;

  try {
    pack = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in layout pack file ${filePath}: ${err}`);
  }

  const validation = validateLayoutPack(pack, schemaFilePath);
  if (!validation.valid) {
    const errors = validation.errors?.join('\n') || 'Unknown validation errors';
    throw new Error(`Layout pack validation failed:\n${errors}`);
  }

  return pack as LayoutPack;
}

/**
 * Validates a layout pack object against the schema
 * @param pack - Layout pack object to validate
 * @param schemaFilePath - Path to JSON schema file (optional)
 * @returns ValidationResult with valid flag and optional errors
 */
export function validateLayoutPack(pack: unknown, schemaFilePath: string = defaultSchemaPath): ValidationResult {
  if (!fs.existsSync(schemaFilePath)) {
    return {
      valid: false,
      errors: [`Schema file not found: ${schemaFilePath}`]
    };
  }

  const schemaRaw = fs.readFileSync(schemaFilePath, "utf-8");
  let schema: unknown;

  try {
    schema = JSON.parse(schemaRaw);
  } catch (err) {
    return {
      valid: false,
      errors: [`Invalid schema JSON: ${err}`]
    };
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validateFn = ajv.compile(schema);
  const valid = validateFn(pack);

  if (!valid) {
    const errors = validateFn.errors?.map(err => `${err.instancePath} ${err.message}`) || [];
    return { valid: false, errors };
  }

  return { valid: true };
}