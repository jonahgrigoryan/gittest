export async function run() {
  // Load config; default to repo config if BOT_CONFIG not provided
  const path = await import("path");
  const { config } = await import("@poker-bot/shared");
  const cfgPath = process.env.BOT_CONFIG || path.resolve(process.cwd(), "../../config/bot/default.bot.json");
  const cfg = config.loadConfig(cfgPath);

  if (process.env.ORCH_PING_SOLVER === "1") {
    // Compile-time link check to shared generated stubs
    const { makeRequest, parseResponse } = await import("./solver_client/client");
    const req = makeRequest("ping");
    // fake response parse to exercise types
    parseResponse({ actions: ["fold"], probabilities: [1] } as any);
  }

  return { ok: true, configLoaded: !!cfg };
}
