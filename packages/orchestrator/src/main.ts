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
  if (process.env.ENABLE_VISION === "1") {
    await initializeVisionSystem(configManager);
  }

  return { ok: true, configLoaded: !!configManager };
}

async function initializeVisionSystem(configManager: any) {
  // Import vision components
  const { VisionClient } = await import("./vision/client");
  const { GameStateParser } = await import("./vision/parser");
  const { loadLayoutPack } = await import("@poker-bot/shared/src/vision/layout-loader");

  // Load layout pack from config
  const layoutPackPath = configManager.get("vision.layoutPackPath") ||
    "../../config/layout-packs/simulator/default.layout.json";
  const layoutPack = loadLayoutPack(layoutPackPath);

  // Create vision client
  const visionUrl = configManager.get("vision.serviceUrl") || "localhost:50052";
  const visionClient = new VisionClient(visionUrl, layoutPack);

  // Create parser with safety features
  const parserConfig = {
    confidenceThreshold: configManager.get("vision.confidenceThreshold") || 0.995,
    occlusionThreshold: configManager.get("vision.occlusionThreshold") || 0.05,
    enableInference: true
  };
  const parser = new GameStateParser(parserConfig);

  // Main decision loop (placeholder)
  console.log("Vision system initialized. Starting decision loop...");

  // Placeholder decision loop
  setInterval(async () => {
    try {
      // Capture and parse vision data
      const visionOutput = await visionClient.captureAndParse();
      const gameState = parser.parseWithSafety(visionOutput, parserConfig);

      // Check if safe action was triggered
      if (gameState.safeActionTriggered) {
        console.log(`SafeAction triggered: ${gameState.recommendedAction?.type}`);
      } else if (gameState.recommendedAction) {
        console.log(`Forced action: ${gameState.recommendedAction.type}`);
      } else {
        console.log("Normal operation - would call strategy solver");
      }

      // Log confidence and latency
      console.log(`Confidence: ${gameState.confidence.overall.toFixed(3)}, Latency: ${gameState.latency}ms`);

    } catch (error) {
      console.error("Vision processing error:", error);
    }
  }, 1000); // Poll every second
}
