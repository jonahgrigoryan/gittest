import { describe, it, expect } from "vitest";
import { AGENTS_OK } from "../src/index";

describe("agents", () => {
  it("has a trivial export", () => {
    expect(AGENTS_OK).toBe(true);
  });
});
