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

  // Initialize vision system if enabled
  let visionClient = null;
  if (process.env.ENABLE_VISION === "1") {
    const vision = await import("@poker-bot/shared/vision");
    const { VisionClient } = await import("./vision/client");
    const { GameStateParser } = await import("./vision/parser");
    
    // Load layout pack
    const layoutPackPath = process.env.LAYOUT_PACK_PATH || 
      path.resolve(process.cwd(), "../../config/layout-packs/simulator/default.layout.json");
    const layoutPack = vision.loadLayoutPack(layoutPackPath);
    
    // Create vision client
    const visionServiceUrl = process.env.VISION_SERVICE_URL || "localhost:50052";
    visionClient = new VisionClient(visionServiceUrl, layoutPack);
    
    // Health check
    const healthy = await visionClient.healthCheck();
    if (!healthy) {
      console.warn("Vision service health check failed");
    }
    
    // Create parser with config
    const botConfig = configManager.getConfig();
    const parserConfig = {
      confidenceThreshold: botConfig.vision?.confidenceThreshold ?? 0.995,
      occlusionThreshold: botConfig.vision?.occlusionThreshold ?? 0.05,
      enableInference: true,
    };
    const parser = new GameStateParser(parserConfig);
    
    // Example decision loop (placeholder)
    if (process.env.VISION_TEST_CAPTURE === "1") {
      try {
        const visionOutput = await visionClient.captureAndParse();
        const parsedState = parser.parseWithSafety(visionOutput, botConfig);
        
        if (parsedState.safeActionTriggered) {
          console.log("SafeAction triggered:", parsedState.recommendedAction);
        } else {
          console.log("Game state parsed successfully");
        }
      } catch (error) {
        console.error("Vision capture failed:", error);
      }
    }
  }

  return { ok: true, configLoaded: !!configManager, visionEnabled: !!visionClient };
}
