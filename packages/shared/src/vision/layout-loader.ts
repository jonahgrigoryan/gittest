import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import type { LayoutPack } from './types';
import type { ValidationResult } from '../config/types';

const ajv = new Ajv({ allErrors: true });

let schemaCache: unknown = null;

function loadSchema(): unknown {
  if (schemaCache) {
    return schemaCache;
  }
  
  const schemaPath = path.resolve(__dirname, '../../../../config/schema/layout-pack.schema.json');
  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
  schemaCache = JSON.parse(schemaContent);
  return schemaCache;
}

/**
 * Load and validate a layout pack from JSON file.
 * @param filePath - Path to layout pack JSON file
 * @returns Validated LayoutPack object
 * @throws Error if file cannot be read or validation fails
 */
export function loadLayoutPack(filePath: string): LayoutPack {
  const absolutePath = path.resolve(filePath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Layout pack file not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, 'utf-8');
  let pack: unknown;
  
  try {
    pack = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse layout pack JSON: ${error}`);
  }

  const result = validateLayoutPack(pack);
  if (!result.valid) {
    throw new Error(`Layout pack validation failed:\n${result.errors?.join('\n')}`);
  }

  return pack as LayoutPack;
}

/**
 * Validate a layout pack object against the schema.
 * @param pack - Layout pack object to validate
 * @returns ValidationResult with valid flag and optional errors
 */
export function validateLayoutPack(pack: unknown): ValidationResult {
  const schema = loadSchema();
  const validate = ajv.compile(schema);
  const valid = validate(pack);

  if (!valid) {
    const errors = validate.errors?.map(err => {
      const path = err.instancePath || err.schemaPath || 'root';
      return `${path}: ${err.message}`;
    }) || ['Unknown validation error'];
    
    return { valid: false, errors };
  }

  // Additional custom validation rules
  const errors: string[] = [];
  
  if (typeof pack === 'object' && pack !== null) {
    const lp = pack as Record<string, unknown>;
    
    // Validate ROI coordinates
    if (lp.resolution && typeof lp.resolution === 'object') {
      const res = lp.resolution as { width: number; height: number };
      
      // Check cardROIs
      if (Array.isArray(lp.cardROIs)) {
        lp.cardROIs.forEach((roi: unknown, idx: number) => {
          if (typeof roi === 'object' && roi !== null) {
            const r = roi as Record<string, unknown>;
            const relative = r.relative === true;
            
            if (!relative) {
              if (typeof r.x === 'number' && r.x + (r.width as number) > res.width) {
                errors.push(`cardROIs[${idx}]: x + width exceeds resolution width`);
              }
              if (typeof r.y === 'number' && r.y + (r.height as number) > res.height) {
                errors.push(`cardROIs[${idx}]: y + height exceeds resolution height`);
              }
            } else {
              if (typeof r.x === 'number' && (r.x < 0 || r.x > 1)) {
                errors.push(`cardROIs[${idx}]: relative x must be in [0, 1] range`);
              }
              if (typeof r.y === 'number' && (r.y < 0 || r.y > 1)) {
                errors.push(`cardROIs[${idx}]: relative y must be in [0, 1] range`);
              }
              if (typeof r.width === 'number' && (r.width < 0 || r.width > 1)) {
                errors.push(`cardROIs[${idx}]: relative width must be in [0, 1] range`);
              }
              if (typeof r.height === 'number' && (r.height < 0 || r.height > 1)) {
                errors.push(`cardROIs[${idx}]: relative height must be in [0, 1] range`);
              }
            }
          }
        });
      }
      
      // Check stackROIs
      if (typeof lp.stackROIs === 'object' && lp.stackROIs !== null) {
        Object.entries(lp.stackROIs).forEach(([pos, roi]) => {
          if (typeof roi === 'object' && roi !== null) {
            const r = roi as Record<string, unknown>;
            const relative = r.relative === true;
            
            if (!relative) {
              if (typeof r.x === 'number' && r.x + (r.width as number) > res.width) {
                errors.push(`stackROIs[${pos}]: x + width exceeds resolution width`);
              }
              if (typeof r.y === 'number' && r.y + (r.height as number) > res.height) {
                errors.push(`stackROIs[${pos}]: y + height exceeds resolution height`);
              }
            }
          }
        });
      }
      
      // Check other ROIs similarly
      const roiFields = ['potROI', 'buttonROI', 'turnIndicatorROI'];
      roiFields.forEach(field => {
        if (lp[field] && typeof lp[field] === 'object') {
          const roi = lp[field] as Record<string, unknown>;
          const relative = roi.relative === true;
          
          if (!relative) {
            if (typeof roi.x === 'number' && roi.x + (roi.width as number) > res.width) {
              errors.push(`${field}: x + width exceeds resolution width`);
            }
            if (typeof roi.y === 'number' && roi.y + (roi.height as number) > res.height) {
              errors.push(`${field}: y + height exceeds resolution height`);
            }
          }
        }
      });
      
      // Check actionButtonROIs
      if (lp.actionButtonROIs && typeof lp.actionButtonROIs === 'object') {
        Object.entries(lp.actionButtonROIs).forEach(([button, roi]) => {
          if (typeof roi === 'object' && roi !== null) {
            const r = roi as Record<string, unknown>;
            const relative = r.relative === true;
            
            if (!relative) {
              if (typeof r.x === 'number' && r.x + (r.width as number) > res.width) {
                errors.push(`actionButtonROIs[${button}]: x + width exceeds resolution width`);
              }
              if (typeof r.y === 'number' && r.y + (r.height as number) > res.height) {
                errors.push(`actionButtonROIs[${button}]: y + height exceeds resolution height`);
              }
            }
          }
        });
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}
