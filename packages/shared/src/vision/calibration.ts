import type { ROI, LayoutPack } from "./types";

/**
 * Scale an ROI by a multiplier factor
 * @param roi - Original ROI
 * @param scale - Scale factor (e.g., 1.5 for 150% DPI)
 * @returns New ROI with scaled coordinates
 */
export function scaleROI(roi: ROI, scale: number): ROI {
  // Don't scale relative coordinates
  if (roi.relative) {
    return { ...roi };
  }

  return {
    x: Math.round(roi.x * scale),
    y: Math.round(roi.y * scale),
    width: Math.round(roi.width * scale),
    height: Math.round(roi.height * scale),
    relative: roi.relative,
  };
}

/**
 * Calibrate a layout pack for a different DPI setting
 * @param pack - Original layout pack
 * @param targetDPI - Target DPI multiplier
 * @returns New LayoutPack with scaled ROIs and updated dpiCalibration
 */
export function calibrateLayoutPack(
  pack: LayoutPack,
  targetDPI: number
): LayoutPack {
  const scale = targetDPI / pack.dpiCalibration;

  // If scale is 1.0, return copy without modifications
  if (Math.abs(scale - 1.0) < 0.001) {
    return { ...pack };
  }

  return {
    ...pack,
    dpiCalibration: targetDPI,
    resolution: {
      width: Math.round(pack.resolution.width * scale),
      height: Math.round(pack.resolution.height * scale),
    },
    cardROIs: pack.cardROIs.map((roi) => scaleROI(roi, scale)),
    stackROIs: Object.fromEntries(
      Object.entries(pack.stackROIs).map(([pos, roi]) => [pos, scaleROI(roi, scale)])
    ) as Record<string, ROI>,
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
