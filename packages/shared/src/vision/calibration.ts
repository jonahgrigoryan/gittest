import type { ROI, LayoutPack } from './types';

/**
 * Scales an ROI by the given factor, rounding coordinates to integers
 * @param roi - Region of interest to scale
 * @param scale - Scale factor to apply
 * @returns Scaled ROI with integer coordinates
 */
export function scaleROI(roi: ROI, scale: number): ROI {
  return {
    x: Math.round(roi.x * scale),
    y: Math.round(roi.y * scale),
    width: Math.round(roi.width * scale),
    height: Math.round(roi.height * scale),
    relative: roi.relative
  };
}

/**
 * Calibrates a layout pack for a target DPI
 * @param pack - Original layout pack
 * @param targetDPI - Target DPI to calibrate for
 * @returns New LayoutPack with scaled ROIs and updated calibration
 */
export function calibrateLayoutPack(pack: LayoutPack, targetDPI: number): LayoutPack {
  const scale = targetDPI / pack.dpiCalibration;

  // Scale all ROIs
  const scaledCardROIs = pack.cardROIs.map(roi => scaleROI(roi, scale));
  const scaledStackROIs: Record<string, ROI> = {};
  for (const [position, roi] of Object.entries(pack.stackROIs)) {
    scaledStackROIs[position] = scaleROI(roi, scale);
  }
  const scaledPotROI = scaleROI(pack.potROI, scale);
  const scaledButtonROI = scaleROI(pack.buttonROI, scale);
  const scaledActionButtonROIs = {
    fold: scaleROI(pack.actionButtonROIs.fold, scale),
    check: scaleROI(pack.actionButtonROIs.check, scale),
    call: scaleROI(pack.actionButtonROIs.call, scale),
    raise: scaleROI(pack.actionButtonROIs.raise, scale),
    bet: scaleROI(pack.actionButtonROIs.bet, scale),
    allIn: scaleROI(pack.actionButtonROIs.allIn, scale)
  };
  const scaledTurnIndicatorROI = scaleROI(pack.turnIndicatorROI, scale);

  return {
    ...pack,
    dpiCalibration: targetDPI,
    cardROIs: scaledCardROIs,
    stackROIs: scaledStackROIs,
    potROI: scaledPotROI,
    buttonROI: scaledButtonROI,
    actionButtonROIs: scaledActionButtonROIs,
    turnIndicatorROI: scaledTurnIndicatorROI
  };
}