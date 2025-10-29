import { describe, it, expect } from "vitest";
import { LOGGER_OK } from "../src/index";

describe("logger", () => {
  it("has a trivial export", () => {
    expect(LOGGER_OK).toBe(true);
  });
});
