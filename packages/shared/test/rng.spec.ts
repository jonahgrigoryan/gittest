import { describe, it, expect } from "vitest";
import { generateRngSeed, validateSeed } from "../src/rng";

describe("rng helpers", () => {
  it("generates deterministic seeds for identical inputs", () => {
    const seedA = generateRngSeed("hand-1", "session-1");
    const seedB = generateRngSeed("hand-1", "session-1");
    expect(seedA).toBe(seedB);
  });

  it("produces different seeds for different sessions or hands", () => {
    const seedA = generateRngSeed("hand-1", "session-1");
    const seedB = generateRngSeed("hand-1", "session-2");
    const seedC = generateRngSeed("hand-2", "session-1");
    expect(seedA).not.toBe(seedB);
    expect(seedA).not.toBe(seedC);
  });

  it("handles special characters and empty strings", () => {
    const seedA = generateRngSeed("", "");
    const seedB = generateRngSeed("🔥", "sess");
    expect(validateSeed(seedA)).toBe(true);
    expect(validateSeed(seedB)).toBe(true);
  });
});
