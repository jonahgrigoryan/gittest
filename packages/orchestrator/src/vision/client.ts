import { credentials, type ClientOptions } from "@grpc/grpc-js";
import { VisionServiceClient } from "@poker-bot/shared/gen/vision";
import type { LayoutPack, VisionOutput } from "@poker-bot/shared/vision";

export class VisionClient {
  private client: VisionServiceClient;
  private layoutPack: LayoutPack;

  constructor(serviceUrl: string, layoutPack: LayoutPack, options?: ClientOptions) {
    this.client = new VisionServiceClient(
      serviceUrl,
      credentials.createInsecure(),
      options
    );
    this.layoutPack = layoutPack;
  }

  /**
   * Capture frame and parse game state
   */
  async captureAndParse(): Promise<VisionOutput> {
    return new Promise((resolve, reject) => {
      const request = {
        layout_json: JSON.stringify(this.layoutPack),
      };

      // Note: This uses the generated protobuf types
      // The actual method signature will be determined by the generated code
      (this.client as any).CaptureFrame(request, (error: any, response: any) => {
        if (error) {
          reject(new Error(`Vision service error: ${error.message}`));
          return;
        }

        // Convert protobuf response to VisionOutput
        const visionOutput: VisionOutput = {
          timestamp: Number(response.timestamp),
          cards: {
            holeCards: response.cards.hole_cards || [],
            communityCards: response.cards.community_cards || [],
            confidence: response.cards.confidence,
          },
          stacks: new Map(
            Object.entries(response.stacks || {}).map(([pos, data]: [string, any]) => [
              pos as any,
              { amount: data.amount, confidence: data.confidence },
            ])
          ),
          pot: {
            amount: response.pot.amount,
            confidence: response.pot.confidence,
          },
          buttons: {
            dealer: response.buttons.dealer as any,
            confidence: response.buttons.confidence,
          },
          positions: {
            confidence: response.positions.confidence,
          },
          occlusion: new Map(Object.entries(response.occlusion || {})),
          actionButtons: response.action_buttons
            ? {
                fold: response.action_buttons.fold,
                check: response.action_buttons.check,
                call: response.action_buttons.call,
                raise: response.action_buttons.raise,
                bet: response.action_buttons.bet,
                allIn: response.action_buttons.all_in,
              }
            : undefined,
          turnState: response.turn_state
            ? {
                isHeroTurn: response.turn_state.is_hero_turn,
                actionTimer: response.turn_state.action_timer || undefined,
                confidence: response.turn_state.confidence,
              }
            : undefined,
          latency: {
            capture: response.latency.capture,
            extraction: response.latency.extraction,
            total: response.latency.total,
          },
        };

        resolve(visionOutput);
      });
    });
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return new Promise((resolve) => {
      (this.client as any).HealthCheck({}, (error: any, response: any) => {
        if (error) {
          resolve(false);
          return;
        }
        resolve(response.healthy);
      });
    });
  }

  /**
   * Close client connection
   */
  close(): void {
    this.client.close();
  }
}
