import type { Position, Card } from "@poker-bot/shared";
import type { vision } from "@poker-bot/shared";

export type PositionMap = Map<number, Position>;

const POSITION_ORDER: Position[] = ["BTN", "SB", "BB", "UTG", "MP", "CO"];

export function inferPositions(
  dealerButton: { dealer: Position; confidence: number },
  numPlayers: number
): PositionMap {
  const mapping: PositionMap = new Map();
  const startIndex = POSITION_ORDER.indexOf(dealerButton.dealer);
  if (startIndex === -1) {
    return mapping;
  }

  const playerCount = Math.min(numPlayers, POSITION_ORDER.length);
  for (let i = 0; i < playerCount; i += 1) {
    const seatIndex = (startIndex + i) % POSITION_ORDER.length;
    mapping.set(i, POSITION_ORDER[seatIndex]);
  }
  return mapping;
}

export function inferHeroPosition(layout: vision.LayoutPack): Position {
  const entries = Object.entries(layout.stackROIs || {});
  if (entries.length === 0) {
    return "SB";
  }

  const [position] = entries.reduce((best, current) => {
    const [, bestROI] = best;
    const [, currentROI] = current;
    return currentROI.y > bestROI.y ? current : best;
  });

  return position as Position;
}

export function assignPositions(
  stacks: Map<Position, { stack: number; holeCards?: Card[] }>,
  dealerButton: Position
): Map<Position, { stack: number; holeCards?: Card[] }> {
  const ordered: [Position, { stack: number; holeCards?: Card[] }][] = [];
  for (const position of POSITION_ORDER) {
    const info = stacks.get(position);
    if (info) {
      ordered.push([position, info]);
    }
  }

  const result = new Map<Position, { stack: number; holeCards?: Card[] }>();
  const dealerIndex = POSITION_ORDER.indexOf(dealerButton);
  if (dealerIndex === -1) {
    return stacks;
  }

  const rotation = [...POSITION_ORDER.slice(dealerIndex), ...POSITION_ORDER.slice(0, dealerIndex)];
  rotation.forEach(position => {
    const info = stacks.get(position);
    if (info) {
      result.set(position, info);
    }
  });

  if (result.size === 0) {
    ordered.forEach(([position, info]) => {
      result.set(position, info);
    });
  }

  return result;
}
