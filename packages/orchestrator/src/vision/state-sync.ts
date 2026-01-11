import type { Position } from "@poker-bot/shared";
import type { ParsedGameState } from "@poker-bot/shared";

export class StateSyncTracker {
  private history: ParsedGameState[] = [];

  constructor(private readonly maxFrameHistory: number = 10) {}

  addFrame(state: ParsedGameState): void {
    this.history.push(state);
    if (this.history.length > this.maxFrameHistory) {
      this.history.shift();
    }
  }

  detectInconsistencies(currentState: ParsedGameState): string[] {
    const errors: string[] = [];
    const previous = this.history.at(-1);
    if (!previous) {
      return errors;
    }

    if (this.isNewHand(currentState, previous)) {
      this.history = [];
      return errors;
    }

    if (currentState.pot < previous.pot - 1e-3) {
      errors.push("Pot decreased between consecutive frames");
    }

    previous.players.forEach((prevPlayer, position) => {
      const current = currentState.players.get(position as Position);
      if (current && current.stack > prevPlayer.stack + Math.max(0, previous.pot - currentState.pot) + 0.1) {
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

  private isNewHand(
    current: ParsedGameState,
    previous: ParsedGameState
  ): boolean {
    if (current.street === "preflop" && previous.street !== "preflop") {
      return true;
    }

    if (current.communityCards.length < previous.communityCards.length) {
      return true;
    }

    if (current.handId !== previous.handId) {
      return true;
    }

    return false;
  }
}
