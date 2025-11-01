import type { Position } from "@poker-bot/shared";
import type { vision } from "@poker-bot/shared";

export class StateSyncTracker {
  private history: vision.ParsedGameState[] = [];

  constructor(private readonly maxFrameHistory: number = 10) {}

  addFrame(state: vision.ParsedGameState): void {
    this.history.push(state);
    if (this.history.length > this.maxFrameHistory) {
      this.history.shift();
    }
  }

  detectInconsistencies(currentState: vision.ParsedGameState): string[] {
    const errors: string[] = [];
    const previous = this.history.at(-1);
    if (!previous) {
      return errors;
    }

    if (currentState.pot < previous.pot - 1e-3) {
      errors.push("Pot decreased between consecutive frames");
    }

    previous.players.forEach((prevPlayer, position) => {
      const current = currentState.players.get(position as Position);
      if (current && current.stack > prevPlayer.stack + currentState.pot) {
        errors.push(`Stack increased unexpectedly for position ${position}`);
      }
    });

    return errors;
  }

  getConsecutiveErrorCount(): number {
    let count = 0;
    for (let i = this.history.length - 1; i >= 0; i -= 1) {
      const state = this.history[i];
      if (state.parseErrors.length === 0) {
        break;
      }
      count += 1;
    }
    return count;
  }
}
