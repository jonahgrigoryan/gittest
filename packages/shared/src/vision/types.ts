import type { Position, Card } from "../types";

export interface ROI {
  x: number;
  y: number;
  width: number;
  height: number;
  relative?: boolean; // true if coordinates are relative to window bounds
}

export interface ScreenCoords {
  x: number;
  y: number;
}

export interface ButtonInfo {
  screenCoords: ScreenCoords;
  isEnabled: boolean;
  isVisible: boolean;
  confidence: number;
  text?: string; // button label if detected
}

export interface LayoutPack {
  version: string;
  platform: string;
  theme: string;
  resolution: { width: number; height: number };
  dpiCalibration: number;
  cardROIs: ROI[];
  stackROIs: Record<Position, ROI>;
  potROI: ROI;
  buttonROI: ROI;
  actionButtonROIs: {
    fold: ROI;
    check: ROI;
    call: ROI;
    raise: ROI;
    bet: ROI;
    allIn: ROI;
  };
  turnIndicatorROI: ROI;
  windowPatterns: {
    titleRegex: string;
    processName: string;
    className?: string;
  };
  buttonTemplates?: {
    fold?: string;
    check?: string;
    call?: string;
    raise?: string;
    allIn?: string;
  };
}

export interface VisionOutput {
  timestamp: number;
  cards: {
    holeCards: Card[];
    communityCards: Card[];
    confidence: number;
  };
  stacks: Map<Position, { amount: number; confidence: number }>;
  pot: { amount: number; confidence: number };
  buttons: { dealer: Position; confidence: number };
  positions: { confidence: number }; // confidence in position assignments
  occlusion: Map<string, number>; // percentage occluded per ROI name

  // Action buttons for research UI mode
  actionButtons?: {
    fold?: ButtonInfo;
    check?: ButtonInfo;
    call?: ButtonInfo;
    raise?: ButtonInfo;
    bet?: ButtonInfo;
    allIn?: ButtonInfo;
  };

  // Turn state detection for research UI mode
  turnState?: {
    isHeroTurn: boolean;
    actionTimer?: number; // seconds remaining
    confidence: number;
  };

  latency: {
    capture: number;
    extraction: number;
    total: number;
  };
}
