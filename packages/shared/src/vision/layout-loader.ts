import Ajv, { type ValidateFunction } from "ajv";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { LayoutPack } from "./types";
import layoutPackSchema from "../../../../config/schema/layout-pack.schema.json";

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

let validateFn: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  if (!validateFn) {
    const ajv = new Ajv({ allErrors: true, verbose: true });
    validateFn = ajv.compile(layoutPackSchema);
  }
  return validateFn;
}

/**
 * Load and validate a layout pack from a JSON file
 * @param filePath - Absolute or relative path to layout pack JSON file
 * @returns Validated LayoutPack object
 * @throws Error if file cannot be read or validation fails
 */
export function loadLayoutPack(filePath: string): LayoutPack {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (error) {
    throw new Error(
      `Failed to read layout pack file: ${filePath}\n${error instanceof Error ? error.message : String(error)}`
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Failed to parse layout pack JSON: ${filePath}\n${error instanceof Error ? error.message : String(error)}`
    );
  }

  const result = validateLayoutPack(data);
  if (!result.valid) {
    throw new Error(
      `Layout pack validation failed: ${filePath}\n${result.errors?.join("\n")}`
    );
  }

  return data as LayoutPack;
}

/**
 * Validate a layout pack object against the schema (non-throwing)
 * @param pack - Unknown object to validate
 * @returns ValidationResult with valid flag and optional errors
 */
export function validateLayoutPack(pack: unknown): ValidationResult {
  const validate = getValidator();
  const valid = validate(pack);

  if (valid) {
    // Additional runtime validation
    const typedPack = pack as LayoutPack;
    const errors: string[] = [];

    // Validate ROI coordinates
    const validateROI = (roi: any, name: string) => {
      if (roi.relative) {
        // Relative coordinates must be in [0, 1] range
        if (roi.x < 0 || roi.x > 1) {
          errors.push(`${name}: relative x coordinate must be in [0, 1] range`);
        }
        if (roi.y < 0 || roi.y > 1) {
          errors.push(`${name}: relative y coordinate must be in [0, 1] range`);
        }
        if (roi.width < 0 || roi.width > 1) {
          errors.push(`${name}: relative width must be in [0, 1] range`);
        }
        if (roi.height < 0 || roi.height > 1) {
          errors.push(`${name}: relative height must be in [0, 1] range`);
        }
      } else {
        // Absolute coordinates must be within resolution bounds
        const { width: resWidth, height: resHeight } = typedPack.resolution;
        if (roi.x + roi.width > resWidth) {
          errors.push(
            `${name}: x + width (${roi.x + roi.width}) exceeds resolution width (${resWidth})`
          );
        }
        if (roi.y + roi.height > resHeight) {
          errors.push(
            `${name}: y + height (${roi.y + roi.height}) exceeds resolution height (${resHeight})`
          );
        }
      }
    };

    // Validate all ROIs
    typedPack.cardROIs.forEach((roi, idx) => validateROI(roi, `cardROIs[${idx}]`));
    Object.entries(typedPack.stackROIs).forEach(([pos, roi]) =>
      validateROI(roi, `stackROIs.${pos}`)
    );
    validateROI(typedPack.potROI, "potROI");
    validateROI(typedPack.buttonROI, "buttonROI");
    Object.entries(typedPack.actionButtonROIs).forEach(([btn, roi]) =>
      validateROI(roi, `actionButtonROIs.${btn}`)
    );
    validateROI(typedPack.turnIndicatorROI, "turnIndicatorROI");

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true };
  }

  // Schema validation failed
  const errors = validate.errors?.map((err) => {
    const path = err.instancePath || "(root)";
    const message = err.message || "validation error";
    return `${path}: ${message}`;
  });

  return { valid: false, errors };
}
