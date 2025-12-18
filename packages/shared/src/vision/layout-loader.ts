import fs from "fs";
import path from "path";
import Ajv2020 from "ajv/dist/2020";
import type { ValidateFunction } from "ajv";

import type { LayoutPack, ROI } from "./types";
import type { ValidationResult } from "../config/types";

const DEFAULT_SCHEMA_CANDIDATES = [
  process.env.LAYOUT_PACK_SCHEMA,
  path.resolve(process.env.CONFIG_DIR ?? "/config", "schema/layout-pack.schema.json"),
  path.resolve(process.cwd(), "config/schema/layout-pack.schema.json"),
  path.resolve(__dirname, "../../../../config/schema/layout-pack.schema.json")
].filter(Boolean) as string[];

function resolveDefaultSchemaPath(): string {
  for (const candidate of DEFAULT_SCHEMA_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return DEFAULT_SCHEMA_CANDIDATES[DEFAULT_SCHEMA_CANDIDATES.length - 1];
}

const defaultSchemaPath = resolveDefaultSchemaPath();

interface ValidatorCache {
  schemaPath: string;
  validateFn: ValidateFunction;
}

let cache: ValidatorCache | null = null;

function getValidator(schemaFilePath: string): ValidateFunction {
  if (cache && cache.schemaPath === schemaFilePath) {
    return cache.validateFn;
  }

  const schemaRaw = fs.readFileSync(schemaFilePath, "utf-8");
  const schema = JSON.parse(schemaRaw);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validateFn = ajv.compile(schema);
  cache = { schemaPath: schemaFilePath, validateFn };
  return validateFn;
}

function collectRois(pack: LayoutPack): Array<{ name: string; roi: ROI }> {
  const rois: Array<{ name: string; roi: ROI }> = [];

  pack.cardROIs.forEach((roi, index) => {
    rois.push({ name: `cardROIs[${index}]`, roi });
  });

  (Object.keys(pack.stackROIs) as Array<keyof typeof pack.stackROIs>).forEach(key => {
    rois.push({ name: `stackROIs.${key}`, roi: pack.stackROIs[key] });
  });

  rois.push({ name: "potROI", roi: pack.potROI });
  rois.push({ name: "buttonROI", roi: pack.buttonROI });
  rois.push({ name: "turnIndicatorROI", roi: pack.turnIndicatorROI });

  rois.push({ name: "actionButtonROIs.fold", roi: pack.actionButtonROIs.fold });
  rois.push({ name: "actionButtonROIs.check", roi: pack.actionButtonROIs.check });
  rois.push({ name: "actionButtonROIs.call", roi: pack.actionButtonROIs.call });
  rois.push({ name: "actionButtonROIs.raise", roi: pack.actionButtonROIs.raise });
  rois.push({ name: "actionButtonROIs.bet", roi: pack.actionButtonROIs.bet });
  rois.push({ name: "actionButtonROIs.allIn", roi: pack.actionButtonROIs.allIn });

  return rois;
}

function validateRoiBounds(pack: LayoutPack): string[] {
  const errors: string[] = [];
  const { width: screenWidth, height: screenHeight } = pack.resolution;

  for (const entry of collectRois(pack)) {
    const { name, roi } = entry;
    if (roi.relative) {
      if (roi.x < 0 || roi.x > 1 || roi.y < 0 || roi.y > 1) {
        errors.push(`${name}: relative coordinates must be within [0, 1]`);
      }
      if (roi.width <= 0 || roi.width > 1 || roi.height <= 0 || roi.height > 1) {
        errors.push(`${name}: relative width/height must be within (0, 1]`);
      }
      continue;
    }

    if (roi.x < 0 || roi.y < 0) {
      errors.push(`${name}: coordinates must be non-negative`);
    }
    if (roi.width <= 0 || roi.height <= 0) {
      errors.push(`${name}: width and height must be positive`);
      continue;
    }

    const maxX = roi.x + roi.width;
    const maxY = roi.y + roi.height;
    if (maxX > screenWidth) {
      errors.push(`${name}: x + width exceeds resolution width (${screenWidth})`);
    }
    if (maxY > screenHeight) {
      errors.push(`${name}: y + height exceeds resolution height (${screenHeight})`);
    }
  }

  return errors;
}

export function validateLayoutPack(
  pack: unknown,
  schemaFilePath: string = defaultSchemaPath
): ValidationResult {
  const validateFn = getValidator(schemaFilePath);
  const valid = validateFn(pack);

  if (!valid) {
    const errors = validateFn.errors?.map(err => `${err.instancePath || "/"} ${err.message}`) || [];
    return { valid: false, errors };
  }

  const roiErrors = validateRoiBounds(pack as LayoutPack);
  if (roiErrors.length > 0) {
    return { valid: false, errors: roiErrors };
  }

  return { valid: true };
}

function assertValidLayoutPack(pack: unknown, schemaFilePath: string): asserts pack is LayoutPack {
  const result = validateLayoutPack(pack, schemaFilePath);
  if (!result.valid) {
    const details = result.errors?.join("\n") || "unknown validation error";
    throw new Error(`Layout pack validation failed:\n${details}`);
  }
}

export function loadLayoutPack(
  filePath: string,
  schemaFilePath: string = defaultSchemaPath
): LayoutPack {
  const raw = fs.readFileSync(filePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse layout pack at ${filePath}: ${(error as Error).message}`);
  }

  assertValidLayoutPack(parsed, schemaFilePath);
  return parsed;
}
