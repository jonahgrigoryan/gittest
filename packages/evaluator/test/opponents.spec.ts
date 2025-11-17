import { describe, it, expect } from "vitest";
import { getOpponentDefinition, listOpponentDefinitions } from "../src/opponents/registry";

describe("opponent registry", () => {
  it("lists default opponents", () => {
    const defs = listOpponentDefinitions();
    expect(defs.length).toBeGreaterThan(0);
  });

  it("retrieves opponent by id", () => {
    const tag = getOpponentDefinition("tight_aggressive");
    expect(tag?.id).toBe("tight_aggressive");
  });
});
