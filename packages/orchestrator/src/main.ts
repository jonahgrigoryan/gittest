export async function run() {
  // Load config; default to repo config if BOT_CONFIG not provided
  const path = await import("path");
  const shared = await import("@poker-bot/shared");
  const { createConfigManager } = shared;
  const cfgPath = process.env.BOT_CONFIG || path.resolve(process.cwd(), "../../config/bot/default.bot.json");
  const configManager = await createConfigManager(cfgPath);
  
  // Optionally start watching for config changes if CONFIG_WATCH is set
  if (process.env.CONFIG_WATCH === "1") {
    await configManager.startWatching();
  }

  if (process.env.ORCH_PING_SOLVER === "1") {
    // Compile-time link check to shared generated stubs
    const { createSolverClient, makeRequest, parseResponse } = await import("./solver_client/client");
    const client = createSolverClient();
    client.close();
    // issue a dummy request for compile-only check
    void makeRequest("ping");
    // fake response parse to exercise types without runtime imports
    type SubgameResponse = import("@poker-bot/shared/src/gen/solver").SubgameResponse;
    const fake: SubgameResponse = { actions: ["fold"], probabilities: [1] };
    parseResponse(fake);
  }

  return { ok: true, configLoaded: !!configManager };
}
