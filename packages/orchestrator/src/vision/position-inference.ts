import type { VisionOutput } from '../../../shared/src/vision/types';
import type { Position } from '../../../shared/src/types';

export interface PositionMap {
  [screenPosition: string]: Position;
}

/**
 * Infer positions from dealer button location and number of players.
 */
export function inferPositions(dealerButton: Position, numPlayers: number = 6): PositionMap {
  const positions: PositionMap = {};

  // Standard 6-max positions in order
  const positionOrder: Position[] = ['SB', 'BB', 'UTG', 'MP', 'CO', 'BTN'];

  // Find button index
  const buttonIndex = positionOrder.indexOf(dealerButton);
  if (buttonIndex === -1) {
    // Fallback to BTN if dealer position not found
    return { 'button': 'BTN' };
  }

  // Assign positions relative to button
  for (let i = 0; i < numPlayers; i++) {
    const positionIndex = (buttonIndex + i) % numPlayers;
    const position = positionOrder[positionIndex];
    positions[`player_${i}`] = position;
  }

  return positions;
}

/**
 * Infer hero position from layout pack (typically bottom center).
 */
export function inferHeroPosition(layout: any): Position {
  // For now, assume hero is always in a fixed position
  // In production, would use layout analysis
  return 'HERO' as Position;
}

/**
 * Assign positions to players based on dealer button and detected stacks.
 */
export function assignPositions(
  stacks: Map<Position, any>,
  dealerButton: Position
): Map<Position, any> {
  // For now, return stacks as-is
  // In production, would rotate positions based on button
  return stacks;
}