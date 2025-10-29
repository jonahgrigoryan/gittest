import { describe, it, expect } from "vitest";
import { run } from "../src/main";

describe("orchestrator", () => {
  it("runs without contacting solver", async () => {
    const res = await run();
    expect(res.ok).toBe(true);
  }, 15000);
});
