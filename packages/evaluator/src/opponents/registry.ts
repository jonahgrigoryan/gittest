import type { OpponentDefinition } from "./types";

function createPolicy(options: { aggression: number; bluff: number }): OpponentDefinition["policy"] {
  return ({ pot, aggressionFactor, bluffFrequency, rng }) => {
    const agg = aggressionFactor * options.aggression;
    if (rng() < options.bluff * bluffFrequency) {
      return { action: "raise", amount: pot * Math.min(agg, 3) };
    }
    if (rng() > agg / 3) {
      return { action: "call" };
    }
    return { action: "fold" };
  };
}

const definitions: Record<string, OpponentDefinition> = {
  tight_aggressive: {
    id: "tight_aggressive",
    description: "Low VPIP, raises premium holdings",
    policy: createPolicy({ aggression: 1.4, bluff: 0.1 })
  },
  loose_passive: {
    id: "loose_passive",
    description: "Calls wide, rarely raises",
    policy: createPolicy({ aggression: 0.7, bluff: 0.05 })
  },
  mixed_gto: {
    id: "mixed_gto",
    description: "Balanced strategy mixing raises/calls",
    policy: createPolicy({ aggression: 1, bluff: 0.15 })
  },
  baseline_proxy: {
    id: "baseline_proxy",
    description: "Proxy for CFR baseline – value heavy, minimal bluffs",
    policy: createPolicy({ aggression: 0.9, bluff: 0.02 })
  }
};

export function getOpponentDefinition(id: string): OpponentDefinition | undefined {
  return definitions[id];
}

export function listOpponentDefinitions(): OpponentDefinition[] {
  return Object.values(definitions);
}

export function registerOpponent(def: OpponentDefinition) {
  definitions[def.id] = def;
}
