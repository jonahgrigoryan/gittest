import { describe, it, expect } from "vitest";
import path from "path";
import { loadConfig } from "../src/config/loader";

describe("config loader", () => {
  it("loads and validates default config", () => {
    const cfgPath = path.resolve(__dirname, "../../../config/bot/default.bot.json");
    const cfg = loadConfig(cfgPath);
    expect(cfg).toBeTruthy();
    expect(cfg).toHaveProperty("vision");
  });
});
