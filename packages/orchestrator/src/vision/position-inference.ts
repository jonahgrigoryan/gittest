import type { Position } from "@poker-bot/shared";
import type { LayoutPack } from "@poker-bot/shared/vision";

export type PositionMap = Map<string, Position>;

/**
 * Infer player positions based on dealer button location
 */
export function inferPositions(
  dealerPosition: Position,
  numPlayers: number
): PositionMap {
  const positionMap = new Map<string, Position>();

  // Define position order (clockwise from button)
  const positionOrder: Position[] = ["BTN", "SB", "BB", "UTG", "MP", "CO"];

  // Find dealer index
  const dealerIndex = positionOrder.indexOf(dealerPosition);
  if (dealerIndex === -1) {
    throw new Error(`Invalid dealer position: ${dealerPosition}`);
  }

  // Assign positions in clockwise order
  for (let i = 0; i < numPlayers; i++) {
    const posIndex = (dealerIndex + i) % positionOrder.length;
    const position = positionOrder[posIndex];
    positionMap.set(`seat_${i}`, position);
  }

  return positionMap;
}

/**
 * Infer hero position (typically bottom center of screen)
 */
export function inferHeroPosition(layout: LayoutPack): Position {
  // Hero is typically at bottom center
  // For standard 6-max layout, this is usually BTN or CO position
  return "BTN";
}

/**
 * Assign positions to players based on dealer button
 */
export function assignPositions(
  stacks: Map<Position, { stack: number; holeCards?: any }>,
  dealerButton: Position
): Map<Position, { stack: number; holeCards?: any }> {
  // For now, return stacks as-is
  // In production, would rotate based on dealer button
  return new Map(stacks);
}
