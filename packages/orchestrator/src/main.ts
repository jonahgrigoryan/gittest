import { GameStateParser } from "./vision/parser";
import { VisionClient } from "./vision/client";
import type { ParserConfig } from "@poker-bot/shared/src/vision/parser-types";

export async function run() {
  const path = await import("path");
  const shared = await import("@poker-bot/shared");
  const { createConfigManager, vision } = shared;

  const cfgPath = process.env.BOT_CONFIG || path.resolve(process.cwd(), "../../config/bot/default.bot.json");
  const configManager = await createConfigManager(cfgPath);

  if (process.env.CONFIG_WATCH === "1") {
    await configManager.startWatching();
  }

  if (process.env.ORCH_PING_SOLVER === "1") {
    const { createSolverClient, makeRequest, parseResponse } = await import("./solver_client/client");
    const client = createSolverClient();
    client.close();
    void makeRequest("ping");
    type SubgameResponse = import("@poker-bot/shared/src/gen/solver").SubgameResponse;
    const fake: SubgameResponse = { actions: ["fold"], probabilities: [1] };
    parseResponse(fake);
  }

  const layoutPackPath = configManager.get<string>("vision.layoutPack");
  const resolvedLayoutPath = path.resolve(process.cwd(), "../../", layoutPackPath);
  const layoutPack = vision.loadLayoutPack(resolvedLayoutPath);

  const parserConfig: ParserConfig = {
    confidenceThreshold: configManager.get<number>("vision.confidenceThreshold"),
    occlusionThreshold: configManager.get<number>("vision.occlusionThreshold"),
    enableInference: true
  };

  const parser = new GameStateParser(parserConfig);
  void parser;

  const visionServiceUrl = process.env.VISION_SERVICE_URL ?? "0.0.0.0:50052";
  const visionClient = new VisionClient(visionServiceUrl, layoutPack);

  if (process.env.ORCH_PING_VISION === "1") {
    try {
      await visionClient.healthCheck();
    } catch (error) {
      console.warn("Vision service health check failed:", error);
    } finally {
      visionClient.close();
    }
  } else {
    visionClient.close();
  }

  return {
    ok: true,
    configLoaded: !!configManager,
    vision: {
      serviceUrl: visionServiceUrl,
      layoutPath: resolvedLayoutPath,
      parserConfig
    }
  };
}
