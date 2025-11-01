import { describe, expect, it } from "vitest";

import { shouldTriggerSafeAction } from "../../src/safety/safe-action";
import { createBotConfig, createParsedState } from "../utils/factories";

describe("Confidence Gating", () => {
  const baseConfig = createBotConfig();

  it("triggers SafeAction when overall confidence < 0.995", () => {
    const state = createParsedState({ confidence: { overall: 0.99, perElement: new Map() } });
    expect(shouldTriggerSafeAction(state, baseConfig)).toBe(true);
  });

  it("triggers SafeAction when any element occluded > 5%", () => {
    const state = createParsedState({
      inferredValues: { occlusion: { hero: 0.06 } },
      confidence: { overall: 1, perElement: new Map() }
    });
    expect(shouldTriggerSafeAction(state, baseConfig)).toBe(true);
  });

  it("does not trigger when confidence = 0.995", () => {
    const state = createParsedState({ confidence: { overall: 0.995, perElement: new Map() } });
    expect(shouldTriggerSafeAction(state, baseConfig)).toBe(false);
  });

  it("does not trigger when occlusion = 5%", () => {
    const state = createParsedState({
      inferredValues: { occlusion: { hero: 0.05 } },
      confidence: { overall: 1, perElement: new Map() }
    });
    expect(shouldTriggerSafeAction(state, baseConfig)).toBe(false);
  });

  it("uses config thresholds correctly", () => {
    const customConfig = createBotConfig({ vision: { confidenceThreshold: 0.9, occlusionThreshold: 0.2 } });
    const state = createParsedState({
      confidence: { overall: 0.91, perElement: new Map() },
      inferredValues: { occlusion: { hero: 0.15 } }
    });
    expect(shouldTriggerSafeAction(state, customConfig)).toBe(false);
  });
});
