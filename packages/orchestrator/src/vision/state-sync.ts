import type { GameState, Action, Position } from '@poker-bot/shared/src/types';
import type { ParsedGameState } from './parser-types';

export class StateSyncTracker {
  private frameHistory: ParsedGameState[] = [];
  private maxHistory: number;

  constructor(maxFrameHistory: number = 10) {
    this.maxHistory = maxFrameHistory;
  }

  addFrame(state: ParsedGameState): void {
    this.frameHistory.push(state);
    if (this.frameHistory.length > this.maxHistory) {
      this.frameHistory.shift();
    }
  }

  detectInconsistencies(currentState: ParsedGameState): string[] {
    const errors: string[] = [];

    if (this.frameHistory.length === 0) {
      return errors;
    }

    const previousState = this.frameHistory[this.frameHistory.length - 1];

    // Check for impossible pot decrease
    if (currentState.pot < previousState.pot && currentState.street === previousState.street) {
      errors.push(`Pot decreased from ${previousState.pot} to ${currentState.pot} on same street`);
    }

    // Check for impossible stack increase mid-hand
    for (const [pos, player] of currentState.players.entries()) {
      const prevPlayer = previousState.players.get(pos);
      if (prevPlayer && player.stack > prevPlayer.stack && currentState.street === previousState.street) {
        errors.push(`Stack increased for ${pos} from ${prevPlayer.stack} to ${player.stack} mid-hand`);
      }
    }

    return errors;
  }

  getConsecutiveErrorCount(): number {
    let count = 0;
    for (let i = this.frameHistory.length - 1; i >= 0; i--) {
      const state = this.frameHistory[i];
      if (state.parseErrors.length > 0 || state.missingElements.length > 0) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }
}
