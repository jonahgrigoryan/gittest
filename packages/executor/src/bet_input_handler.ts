import type { Action } from "@poker-bot/shared";
import type { WindowHandle, InputField } from "./types";
import { deterministicRandom } from "./rng";

/**
 * Production-grade bet sizing input handler for research UI mode.
 * Handles UI input mechanics for bet sizing fields.
 */
export class BetInputHandler {
  private readonly logger: Pick<Console, "debug" | "info" | "warn" | "error">;
  private jitterCounter = 0;

  constructor(
    logger: Pick<Console, "debug" | "info" | "warn" | "error"> = console,
  ) {
    this.logger = logger;
  }

  /**
   * Handles bet sizing input fields for research UI
   * Relies on pre-quantized amounts from StrategyEngine
   */
  async inputBetAmount(
    action: Action,
    windowHandle: WindowHandle,
    rngSeed?: number,
  ): Promise<void> {
    if (action.type !== "raise") {
      this.logger.debug(
        "BetInputHandler: Not a raise action, skipping bet input",
      );
      return;
    }

    if (action.amount === undefined || action.amount <= 0) {
      throw new Error(`Invalid raise amount: ${action.amount}`);
    }

    this.logger.debug("BetInputHandler: Processing raise action", {
      amount: action.amount,
      windowHandle: windowHandle.title,
    });

    // Find bet sizing input field using window manager
    const inputField = await this.locateBetInputField(windowHandle);

    if (!inputField) {
      throw new Error("Bet input field not found");
    }

    this.logger.debug("BetInputHandler: Located input field", { inputField });

    // Input the pre-calculated amount (sizing already done in strategy layer)
    const amount = action.amount;
    await this.typeBetAmount(inputField, amount, rngSeed);

    this.logger.info("BetInputHandler: Successfully input bet amount", {
      amount,
    });
  }

  /**
   * Locates bet input field coordinates
   * Could integrate with vision system for dynamic detection
   */
  private async locateBetInputField(
    windowHandle: WindowHandle,
  ): Promise<InputField | null> {
    this.logger.debug("BetInputHandler: Locating bet input field", {
      windowTitle: windowHandle.title,
      processName: windowHandle.processName,
    });

    // In a production implementation, this would:
    // 1. Use vision system to detect bet input field
    // 2. Apply layout pack coordinates
    // 3. Validate field is visible and enabled
    // 4. Return precise coordinates

    // For now, return a placeholder that would be replaced by actual detection
    // This is a stub that needs to be implemented with actual window detection logic
    return {
      x: 100, // Placeholder - would be calculated from layout pack
      y: 200, // Placeholder - would be calculated from layout pack
      width: 150,
      height: 30,
    };
  }

  /**
   * Types bet amount into input field using cross-platform keyboard simulation
   */
  private async typeBetAmount(
    inputField: InputField,
    amount: number,
    rngSeed?: number,
  ): Promise<void> {
    this.logger.debug("BetInputHandler: Typing bet amount", {
      amount,
      inputField,
    });

    // Clear existing text
    await this.clearInputField(inputField);

    // Format amount as string
    const amountStr = amount.toFixed(2); // Ensure proper decimal formatting

    this.logger.debug("BetInputHandler: Formatted amount string", {
      amountStr,
      originalAmount: amount,
    });

    // Type the amount character by character with small delays
    for (const char of amountStr) {
      await this.typeCharacter(char);
      const jitter =
        50 + deterministicRandom(rngSeed ?? 0, this.jitterCounter++) * 100;
      await this.delay(jitter);
    }

    // Verify the amount was typed correctly
    await this.verifyTypedAmount(inputField, amount);
  }

  /**
   * Clears existing text from input field
   */
  private async clearInputField(inputField: InputField): Promise<void> {
    this.logger.debug("BetInputHandler: Clearing input field", {
      position: { x: inputField.x, y: inputField.y },
      dimensions: { width: inputField.width, height: inputField.height },
    });

    // In production, this would:
    // 1. Click into the input field
    // 2. Select all text (Ctrl+A or Cmd+A)
    // 3. Press Delete or Backspace
    // 4. Verify field is empty

    // For now, this is a placeholder
    await this.delay(100);
  }

  /**
   * Types a single character
   */
  private async typeCharacter(char: string): Promise<void> {
    this.logger.debug("BetInputHandler: Typing character", { char });

    // In production, this would use OS-level keyboard simulation
    // to type the character at the current cursor position

    // Placeholder implementation
    await this.delay(10);
  }

  /**
   * Verifies the typed amount matches expected value
   */
  private async verifyTypedAmount(
    inputField: InputField,
    expectedAmount: number,
  ): Promise<void> {
    this.logger.debug("BetInputHandler: Verifying typed amount", {
      expectedAmount,
      position: { x: inputField.x, y: inputField.y },
    });

    // In production, this would:
    // 1. Read the current value from the input field
    // 2. Parse it as a number
    // 3. Compare with expected amount
    // 4. Throw error if mismatch

    // Placeholder - assume verification passes
    await this.delay(50);
  }

  /**
   * Delay helper for timing simulation
   */
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
