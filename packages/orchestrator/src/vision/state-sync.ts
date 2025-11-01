import type { ParsedGameState } from '../../../shared/src/vision/parser-types';

export class StateSyncTracker {
  private frameHistory: ParsedGameState[] = [];
  private maxHistory: number;

  constructor(maxFrameHistory: number = 10) {
    this.maxHistory = maxFrameHistory;
  }

  /**
   * Add a new frame to the history.
   */
  addFrame(state: ParsedGameState): void {
    this.frameHistory.push(state);

    // Maintain rolling window
    if (this.frameHistory.length > this.maxHistory) {
      this.frameHistory.shift();
    }
  }

  /**
   * Detect inconsistencies between current state and recent history.
   */
  detectInconsistencies(currentState: ParsedGameState): string[] {
    const errors: string[] = [];

    if (this.frameHistory.length < 2) {
      return errors; // Need at least 2 frames for comparison
    }

    const previousState = this.frameHistory[this.frameHistory.length - 1];

    // Check for impossible pot decrease
    if (currentState.pot < previousState.pot) {
      errors.push(`Pot decreased from ${previousState.pot} to ${currentState.pot}`);
    }

    // Check for impossible stack increases mid-hand
    for (const [position, player] of currentState.players.entries()) {
      const prevPlayer = previousState.players.get(position);
      if (prevPlayer && player.stack > prevPlayer.stack) {
        // Only allow stack increases at hand start or on winning actions
        // For now, flag any increase as suspicious
        errors.push(`Stack for ${position} increased unexpectedly`);
      }
    }

    // Check for sudden confidence drops
    const confidenceDrop = previousState.confidence.overall - currentState.confidence.overall;
    if (confidenceDrop > 0.3) {
      errors.push(`Sudden confidence drop: ${confidenceDrop.toFixed(2)}`);
    }

    return errors;
  }

  /**
   * Get count of consecutive frames with errors.
   */
  getConsecutiveErrorCount(): number {
    let count = 0;

    // Count from most recent frames
    for (let i = this.frameHistory.length - 1; i >= 0; i--) {
      const state = this.frameHistory[i];
      if (state.parseErrors.length > 0) {
        count++;
      } else {
        break; // Stop at first error-free frame
      }
    }

    return count;
  }

  /**
   * Check if we should trigger emergency stop due to consistent errors.
   */
  shouldTriggerEmergencyStop(threshold: number = 5): boolean {
    return this.getConsecutiveErrorCount() >= threshold;
  }
}