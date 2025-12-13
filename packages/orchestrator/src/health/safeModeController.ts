import type { SafeModeState } from "@poker-bot/shared";

interface EnterOptions {
  manual?: boolean;
}

export class SafeModeController {
  private state: SafeModeState = { active: false };

  constructor(private readonly logger: Pick<Console, "info" | "warn"> = console) {}

  enter(reason: string, options: EnterOptions = {}): void {
    if (this.state.active) {
      return;
    }
    this.state = {
      active: true,
      reason,
      enteredAt: Date.now(),
      manual: options.manual ?? false
    };
    this.logger.warn?.(`Safe mode entered: ${reason}`);
  }

  exit(manual = false): void {
    if (!this.state.active) {
      return;
    }
    if (this.state.manual && !manual) {
      // manual safemode requires manual override
      return;
    }
    this.state = { active: false };
    this.logger.info?.("Safe mode exited");
  }

  isActive(): boolean {
    return this.state.active;
  }

  getState(): SafeModeState {
    return { ...this.state };
  }
}
