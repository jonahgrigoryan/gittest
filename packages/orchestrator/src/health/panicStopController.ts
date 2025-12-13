import type { PanicStopReason } from "@poker-bot/shared";
import { SafeModeController } from "./safeModeController";

export class PanicStopController {
  private reason?: PanicStopReason;

  constructor(
    private readonly safeMode: SafeModeController,
    private readonly logger: Pick<Console, "warn" | "error"> = console
  ) {}

  trigger(reason: PanicStopReason): void {
    if (this.reason) {
      return;
    }
    this.reason = reason;
    this.logger.error?.(`Panic stop triggered: ${reason.detail}`);
    this.safeMode.enter(`panic:${reason.type}`, { manual: false });
  }

  reset(): void {
    this.reason = undefined;
  }

  isActive(): boolean {
    return !!this.reason;
  }

  getReason(): PanicStopReason | undefined {
    return this.reason;
  }
}
