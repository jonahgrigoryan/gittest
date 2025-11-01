import type { Position, Card } from '@poker-bot/shared/src/types';
import type { VisionOutput } from '@poker-bot/shared/src/vision/types';

export type PositionMap = Map<string, Position>;

export function inferPositions(
  dealerButton: Position,
  numPlayers: number
): PositionMap {
  const positionOrder: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'MP', 'CO'];
  const btnIdx = positionOrder.indexOf(dealerButton);
  
  const map = new Map<string, Position>();
  
  for (let i = 0; i < numPlayers; i++) {
    const posIdx = (btnIdx + i) % positionOrder.length;
    map.set(`seat_${i}`, positionOrder[posIdx]);
  }

  return map;
}

export function inferHeroPosition(): Position {
  // Hero is typically at bottom center (BB in 6max)
  return 'BB';
}

export function assignPositions(
  stacks: Map<Position, { stack: number; holeCards?: Card[] }>,
  dealerButton: Position
): Map<Position, { stack: number; holeCards?: Card[] }> {
  // Positions are already assigned, just return
  return stacks;
}
