import fs from "fs";
import path from "path";
import Ajv2020 from "ajv/dist/2020";
import type { BotConfig } from "./types";

const defaultSchemaPath = path.resolve(__dirname, "../../../../config/schema/bot-config.schema.json");

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
