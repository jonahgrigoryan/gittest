import type { ParsedGameState } from "@poker-bot/shared/vision";

export class StateSyncTracker {
  private frameHistory: ParsedGameState[] = [];
  private maxFrameHistory: number;

  constructor(maxFrameHistory: number = 10) {
    this.maxFrameHistory = maxFrameHistory;
  }

  /**
   * Add a frame to history
   */
  addFrame(state: ParsedGameState): void {
    this.frameHistory.push(state);

    // Maintain rolling window
    if (this.frameHistory.length > this.maxFrameHistory) {
      this.frameHistory.shift();
    }
  }

  /**
   * Detect inconsistencies between current and previous states
   */
  detectInconsistencies(currentState: ParsedGameState): string[] {
    const errors: string[] = [];

    if (this.frameHistory.length === 0) {
      return errors;
    }

    const previousState = this.frameHistory[this.frameHistory.length - 1];

    // Check for impossible pot decrease (pot should never decrease mid-hand)
    if (currentState.pot < previousState.pot) {
      errors.push(
        `Pot decreased from ${previousState.pot} to ${currentState.pot}`
      );
    }

    // Check for impossible stack increase mid-hand (stacks can only decrease or stay same)
    for (const [pos, playerData] of currentState.players) {
      const prevPlayerData = previousState.players.get(pos);
      if (prevPlayerData && playerData.stack > prevPlayerData.stack) {
        errors.push(
          `Stack for ${pos} increased from ${prevPlayerData.stack} to ${playerData.stack}`
        );
      }
    }

    // Check for street regression (street should only advance forward)
    const streetOrder = ["preflop", "flop", "turn", "river"];
    const currentStreetIndex = streetOrder.indexOf(currentState.street);
    const previousStreetIndex = streetOrder.indexOf(previousState.street);

    if (currentStreetIndex < previousStreetIndex) {
      errors.push(
        `Street regressed from ${previousState.street} to ${currentState.street}`
      );
    }

    return errors;
  }

  /**
   * Get count of consecutive frames with errors
   */
  getConsecutiveErrorCount(): number {
    let count = 0;

    // Count from most recent backwards
    for (let i = this.frameHistory.length - 1; i >= 0; i--) {
      const frame = this.frameHistory[i];
      if (frame.parseErrors.length > 0) {
        count++;
      } else {
        break; // Stop at first frame without errors
      }
    }

    return count;
  }

  /**
   * Clear frame history
   */
  clear(): void {
    this.frameHistory = [];
  }

  /**
   * Get recent frame history
   */
  getHistory(): ParsedGameState[] {
    return [...this.frameHistory];
  }
}
