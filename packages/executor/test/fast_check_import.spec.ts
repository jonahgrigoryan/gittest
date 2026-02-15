import { describe, expect, it } from "vitest";
import fc from "fast-check";

describe("fast-check import", () => {
  it("runs a trivial property", () => {
    const property = fc.property(fc.integer(), (value) =>
      Number.isInteger(value),
    );
    expect(() => fc.assert(property, { numRuns: 5 })).not.toThrow();
  });
});
