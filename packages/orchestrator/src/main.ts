export async function run() {
  // Load config; default to repo config if BOT_CONFIG not provided
  const path = await import('path');
  const shared = await import('@poker-bot/shared');
  const { createConfigManager, loadLayoutPack } = shared;
  const cfgPath = process.env.BOT_CONFIG || path.resolve(process.cwd(), '../../config/bot/default.bot.json');
  const configManager = await createConfigManager(cfgPath);
  
  // Optionally start watching for config changes if CONFIG_WATCH is set
  if (process.env.CONFIG_WATCH === '1') {
    await configManager.startWatching();
  }

  if (process.env.ORCH_PING_SOLVER === '1') {
    // Compile-time link check to shared generated stubs
    const { createSolverClient, makeRequest, parseResponse } = await import('./solver_client/client');
    const client = createSolverClient();
    client.close();
    // issue a dummy request for compile-only check
    void makeRequest('ping');
    // fake response parse to exercise types without runtime imports
    type SubgameResponse = import('@poker-bot/shared/src/gen/solver').SubgameResponse;
    const fake: SubgameResponse = { actions: ['fold'], probabilities: [1] };
    parseResponse(fake);
  }

  // Initialize vision system if enabled
  if (process.env.ENABLE_VISION === '1') {
    const { VisionClient } = await import('./vision/client');
    const { GameStateParser } = await import('./vision/parser');
    
    // Load layout pack
    const layoutPackPath = configManager.get<string>('vision.layoutPack');
    const layoutPack = loadLayoutPack(layoutPackPath);
    
    // Initialize vision client
    const visionServiceUrl = process.env.VISION_SERVICE_URL || 'localhost:50052';
    const visionClient = new VisionClient(visionServiceUrl, layoutPack);
    
    // Initialize parser
    const parserConfig = {
      confidenceThreshold: configManager.get<number>('vision.confidenceThreshold'),
      occlusionThreshold: configManager.get<number>('vision.occlusionThreshold'),
      enableInference: true,
    };
    const parser = new GameStateParser(parserConfig);
    
    // Health check
    const healthy = await visionClient.healthCheck();
    if (!healthy) {
      console.warn('Vision service health check failed');
    }
    
    // Example: capture and parse one frame
    if (process.env.CAPTURE_FRAME === '1') {
      try {
        const visionOutput = await visionClient.captureAndParse();
        const botConfig = {
          vision: {
            layoutPack: layoutPackPath,
            dpiCalibration: configManager.get<number>('vision.dpiCalibration'),
            confidenceThreshold: configManager.get<number>('vision.confidenceThreshold'),
            occlusionThreshold: configManager.get<number>('vision.occlusionThreshold'),
          },
        } as any;
        const gameState = parser.parseWithSafety(visionOutput, botConfig);
        console.log('Parsed game state:', gameState);
      } catch (error) {
        console.error('Vision capture failed:', error);
      }
    }
  }

  return { ok: true, configLoaded: !!configManager };
}
