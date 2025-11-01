import { describe, it, expect } from 'vitest';
import { loadLayoutPack, validateLayoutPack } from '@poker-bot/shared/src/vision/layout-loader';
import { scaleROI, calibrateLayoutPack } from '@poker-bot/shared/src/vision/calibration';
import path from 'path';

describe('Layout Pack System', () => {
  it('loads and validates layout pack', () => {
    const packPath = path.resolve(__dirname, '../../../../config/layout-packs/simulator/default.layout.json');
    const pack = loadLayoutPack(packPath);
    
    expect(pack.version).toBe('1.0.0');
    expect(pack.platform).toBe('simulator');
    expect(pack.resolution.width).toBe(1920);
    expect(pack.resolution.height).toBe(1080);
  });

  it('validates layout pack schema', () => {
    const validPack = {
      version: '1.0.0',
      platform: 'simulator',
      theme: 'default',
      resolution: { width: 1920, height: 1080 },
      dpiCalibration: 1.0,
      cardROIs: [{ x: 100, y: 100, width: 60, height: 85 }],
      stackROIs: { BTN: { x: 100, y: 100, width: 120, height: 40 } },
      potROI: { x: 100, y: 100, width: 150, height: 40 },
      buttonROI: { x: 100, y: 100, width: 30, height: 30 },
      actionButtonROIs: {
        fold: { x: 100, y: 100, width: 100, height: 50 },
        check: { x: 100, y: 100, width: 100, height: 50 },
        call: { x: 100, y: 100, width: 100, height: 50 },
        raise: { x: 100, y: 100, width: 100, height: 50 },
        bet: { x: 100, y: 100, width: 100, height: 50 },
        allIn: { x: 100, y: 100, width: 100, height: 50 },
      },
      turnIndicatorROI: { x: 100, y: 100, width: 200, height: 80 },
      windowPatterns: {
        titleRegex: '.*',
        processName: 'test',
      },
    };

    const result = validateLayoutPack(validPack);
    expect(result.valid).toBe(true);
  });

  it('scales ROI correctly', () => {
    const roi = { x: 100, y: 100, width: 200, height: 300 };
    const scaled = scaleROI(roi, 1.5);
    
    expect(scaled.x).toBe(150);
    expect(scaled.y).toBe(150);
    expect(scaled.width).toBe(300);
    expect(scaled.height).toBe(450);
  });

  it('calibrates layout pack for different DPI', () => {
    const packPath = path.resolve(__dirname, '../../../../config/layout-packs/simulator/default.layout.json');
    const pack = loadLayoutPack(packPath);
    
    const calibrated = calibrateLayoutPack(pack, 1.5);
    expect(calibrated.dpiCalibration).toBe(1.5);
    expect(calibrated.cardROIs[0].x).toBeGreaterThan(pack.cardROIs[0].x);
  });
});
