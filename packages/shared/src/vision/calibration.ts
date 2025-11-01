import type { LayoutPack, ROI } from "./types";

function round(value: number): number {
  return Math.round(value);
}

export function scaleROI(roi: ROI, scale: number): ROI {
  if (scale <= 0) {
    throw new Error("Scale factor must be positive");
  }

  if (roi.relative) {
    // Relative ROIs already represent normalized coordinates; leave untouched.
    return { ...roi };
  }

  return {
    ...roi,
    x: round(roi.x * scale),
    y: round(roi.y * scale),
    width: round(roi.width * scale),
    height: round(roi.height * scale)
  };
}

export function calibrateLayoutPack(pack: LayoutPack, targetDPI: number): LayoutPack {
  if (targetDPI <= 0) {
    throw new Error("targetDPI must be positive");
  }

  const scale = targetDPI / pack.dpiCalibration;
  if (scale === 1) {
    return { ...pack };
  }

  const cardROIs = pack.cardROIs.map(roi => scaleROI(roi, scale));
  const stackROIs = Object.fromEntries(
    Object.entries(pack.stackROIs).map(([position, roi]) => [position, scaleROI(roi, scale)])
  ) as LayoutPack["stackROIs"];

  const actionButtonROIs = {
    fold: scaleROI(pack.actionButtonROIs.fold, scale),
    check: scaleROI(pack.actionButtonROIs.check, scale),
    call: scaleROI(pack.actionButtonROIs.call, scale),
    raise: scaleROI(pack.actionButtonROIs.raise, scale),
    bet: scaleROI(pack.actionButtonROIs.bet, scale),
    allIn: scaleROI(pack.actionButtonROIs.allIn, scale)
  };

  return {
    ...pack,
    resolution: {
      width: round(pack.resolution.width * scale),
      height: round(pack.resolution.height * scale)
    },
    dpiCalibration: targetDPI,
    cardROIs,
    stackROIs,
    potROI: scaleROI(pack.potROI, scale),
    buttonROI: scaleROI(pack.buttonROI, scale),
    actionButtonROIs,
    turnIndicatorROI: scaleROI(pack.turnIndicatorROI, scale)
  };
}
