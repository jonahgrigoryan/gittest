import type { StrategyDecision } from "@poker-bot/shared";

export interface MinimalSimState {
  handId: string;
  bigBlind: number;
  pot: number;
}

export interface SimulationResult {
  netChips: number;
}

export class MinimalSimulator {
  private readonly bigBlind: number;

  constructor(options: { bigBlind: number }) {
    this.bigBlind = options.bigBlind;
  }

  getBigBlind(): number {
    return this.bigBlind;
  }

  playHand(
    decision: StrategyDecision,
    opponentAction: { action: "fold" | "call" | "raise"; amount?: number },
  ): SimulationResult {
    const heroAggression = decision.action.amount ?? this.bigBlind;
    let net = 0;
    if (decision.action.type === "fold") {
      net -= this.bigBlind;
    } else if (opponentAction.action === "fold") {
      net += this.bigBlind;
    } else if (opponentAction.action === "raise") {
      net -= opponentAction.amount ?? this.bigBlind;
    } else {
      net += heroAggression - this.bigBlind;
    }
    return { netChips: net };
  }
}
