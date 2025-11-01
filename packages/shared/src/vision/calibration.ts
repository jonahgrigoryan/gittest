import type { ROI, LayoutPack } from './types';

/**
 * Scale an ROI by a scale factor.
 * @param roi - ROI to scale
 * @param scale - Scale factor (e.g., 1.5 for 150% DPI)
 * @returns New ROI with scaled coordinates
 */
export function scaleROI(roi: ROI, scale: number): ROI {
  return {
    ...roi,
    x: Math.round(roi.x * scale),
    y: Math.round(roi.y * scale),
    width: Math.round(roi.width * scale),
    height: Math.round(roi.height * scale),
  };
}

/**
 * Calibrate a layout pack for a different DPI setting.
 * @param pack - Original layout pack
 * @param targetDPI - Target DPI multiplier (e.g., 1.5 for 150% scaling)
 * @returns New layout pack with scaled ROIs
 */
export function calibrateLayoutPack(pack: LayoutPack, targetDPI: number): LayoutPack {
  const scale = targetDPI / pack.dpiCalibration;
  
  return {
    ...pack,
    dpiCalibration: targetDPI,
    cardROIs: pack.cardROIs.map(roi => scaleROI(roi, scale)),
    stackROIs: Object.fromEntries(
      Object.entries(pack.stackROIs).map(([pos, roi]) => [pos, scaleROI(roi, scale)])
    ) as Record<typeof pack.stackROIs[keyof typeof pack.stackROIs], ROI>,
    potROI: scaleROI(pack.potROI, scale),
    buttonROI: scaleROI(pack.buttonROI, scale),
    actionButtonROIs: {
      fold: scaleROI(pack.actionButtonROIs.fold, scale),
      check: scaleROI(pack.actionButtonROIs.check, scale),
      call: scaleROI(pack.actionButtonROIs.call, scale),
      raise: scaleROI(pack.actionButtonROIs.raise, scale),
      bet: scaleROI(pack.actionButtonROIs.bet, scale),
      allIn: scaleROI(pack.actionButtonROIs.allIn, scale),
    },
    turnIndicatorROI: scaleROI(pack.turnIndicatorROI, scale),
  };
}
