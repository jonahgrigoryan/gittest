import { describe, it, expect } from "vitest";
import { EXECUTOR_OK } from "../src/index";

describe("executor", () => {
  it("has a trivial export", () => {
    expect(EXECUTOR_OK).toBe(true);
  });
});
