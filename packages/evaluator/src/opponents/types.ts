export type OpponentPolicy = (options: {
  pot: number;
  aggressionFactor: number;
  bluffFrequency: number;
  rng: () => number;
}) => { action: "fold" | "call" | "raise"; amount?: number };

export interface OpponentDefinition {
  id: string;
  policy: OpponentPolicy;
  description?: string;
}
