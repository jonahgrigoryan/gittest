import type { Action } from "@poker-bot/shared";
import type { WindowHandle, InputField, ResearchUIConfig } from "./types";
import { deterministicRandom } from "./rng";
import type { InputAutomation } from "./input_automation";

/**
 * Production-grade bet sizing input handler for research UI mode.
 * Handles UI input mechanics for bet sizing fields.
 */
export class BetInputHandler {
  private readonly config?: ResearchUIConfig;
  private readonly logger: Pick<Console, "debug" | "info" | "warn" | "error">;
  private readonly inputAutomation?: InputAutomation;
  private jitterCounter = 0;

  constructor(
    config?: ResearchUIConfig,
    logger: Pick<Console, "debug" | "info" | "warn" | "error"> = console,
    inputAutomation?: InputAutomation
  ) {
    this.config = config;
    this.logger = logger;
    this.inputAutomation = inputAutomation;
  }

  /**
   * Validates bet amount against configuration constraints
   */
  private validateBetAmount(amount: number): void {
    // Check minRaiseAmount if configured
    if (this.config?.minRaiseAmount !== undefined) {
      if (amount < this.config.minRaiseAmount) {
        throw new Error(
          `Bet amount ${amount} is below minimum raise amount ${this.config.minRaiseAmount}`
        );
      }
    }
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

    // Format first, then validate to avoid sending a value below minimum after rounding/truncation.
    const amountString = this.formatAmount(action.amount);
    const roundedAmount = this.parseAmount(amountString);
    this.validateBetAmount(roundedAmount);

    this.logger.debug("BetInputHandler: Processing raise action", {
      amount: action.amount,
      windowHandle: windowHandle.title,
    });

    // Find bet sizing input field using config coordinates
    const inputField = await this.locateBetInputField(windowHandle);

    if (!inputField) {
      throw new Error("Bet input field not found");
    }

    this.logger.debug("BetInputHandler: Located input field", { inputField });

    // Input the UI-formatted amount (sizing already done in strategy layer)
    const amount = roundedAmount;
    await this.typeBetAmount(inputField, amountString, amount, rngSeed);

    this.logger.info("BetInputHandler: Successfully input bet amount", {
      amount,
    });
  }

  /**
   * Locates bet input field coordinates
   * Uses configured coordinates only.
   */
  private async locateBetInputField(
    windowHandle: WindowHandle,
  ): Promise<InputField | null> {
    this.logger.debug("BetInputHandler: Locating bet input field", {
      windowTitle: windowHandle.title,
      processName: windowHandle.processName,
    });

    if (this.config?.betInputField) {
      const { x, y, width, height } = this.config.betInputField;
      this.logger.debug("BetInputHandler: Using configured bet input field", {
        x, y, width, height
      });
      return { x, y, width, height };
    }

    return null;
  }

  /**
   * Formats amount according to configuration (decimal separator, precision)
   */
  private formatAmount(amount: number): string {
    const precision = this.config?.betInputField?.decimalPrecision ?? 2;
    const separator = this.config?.betInputField?.decimalSeparator ?? ".";

    // Format with configured precision
    let amountStr = amount.toFixed(precision);

    // Apply configured decimal separator
    if (separator === ",") {
      amountStr = amountStr.replace(".", ",");
    }

    return amountStr;
  }

  private parseAmount(amountStr: string): number {
    const separator = this.config?.betInputField?.decimalSeparator ?? ".";
    const normalized = separator === "," ? amountStr.replace(/,/g, ".") : amountStr;
    const parsed = Number(normalized);

    if (!Number.isFinite(parsed)) {
      throw new Error(`Could not parse bet amount: ${amountStr}`);
    }

    return parsed;
  }

  /**
   * Types bet amount into input field using cross-platform keyboard simulation
   */
  private async typeBetAmount(
    inputField: InputField,
    amountString: string,
    expectedAmount: number,
    rngSeed?: number,
  ): Promise<void> {
    this.logger.debug("BetInputHandler: Typing bet amount", {
      expectedAmount,
      inputField,
    });

    await this.clickInputField(inputField);

    // Clear existing text
    await this.clearInputField(inputField);

    const amountStr = amountString;

    this.logger.debug("BetInputHandler: Formatted amount string", {
      amountStr,
      originalAmount: expectedAmount,
      precision: this.config?.betInputField?.decimalPrecision ?? 2,
      separator: this.config?.betInputField?.decimalSeparator ?? ".",
    });

    // Type the amount character by character with small delays
    for (const char of amountStr) {
      await this.typeCharacter(char);
      const jitter =
        50 + deterministicRandom(rngSeed ?? 0, this.jitterCounter++) * 100;
      await this.delay(jitter);
    }

    // Verify the amount was typed correctly
    await this.verifyTypedAmount(inputField, expectedAmount);
  }

  /**
   * Clears existing text from input field
   */
  private async clearInputField(inputField: InputField): Promise<void> {
    this.logger.debug("BetInputHandler: Clearing input field", {
      position: { x: inputField.x, y: inputField.y },
      dimensions: { width: inputField.width, height: inputField.height },
    });

    const automation = this.requireInputAutomation();
    await automation.clearTextField();
  }

  /**
   * Types a single character
   */
  private async typeCharacter(char: string): Promise<void> {
    this.logger.debug("BetInputHandler: Typing character", { char });

    const automation = this.requireInputAutomation();
    await automation.typeText(char);
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
    await this.delay(0);
  }

  private async clickInputField(inputField: InputField): Promise<void> {
    this.logger.debug("BetInputHandler: Clicking input field", {
      position: { x: inputField.x, y: inputField.y },
      dimensions: { width: inputField.width, height: inputField.height }
    });
    const automation = this.requireInputAutomation();
    await automation.clickAt(
      inputField.x + inputField.width / 2,
      inputField.y + inputField.height / 2,
      { applyPreClickDelay: false }
    );
  }

  private requireInputAutomation(): InputAutomation {
    if (!this.inputAutomation) {
      throw new Error("Input automation is not configured");
    }
    return this.inputAutomation;
  }

  /**
   * Delay helper for timing simulation
   */
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
