import type { LayoutPack } from '../../../shared/src/vision/types';
import type { VisionOutput } from '../../../shared/src/gen/vision';

export class VisionClient {
  constructor(
    private serviceUrl: string,
    private layoutPack: LayoutPack
  ) {}

  async captureAndParse(): Promise<VisionOutput> {
    // Placeholder implementation - would make gRPC call
    // For now, return mock data

    const mockOutput: VisionOutput = {
      timestamp: Date.now(),
      cards: {
        holeCards: [
          { rank: 'A', suit: 's' },
          { rank: 'K', suit: 'h' }
        ],
        communityCards: [],
        confidence: 0.95
      },
      stacks: new Map([
        ['HERO', { amount: 1000, confidence: 0.9 }],
        ['BTN', { amount: 500, confidence: 0.85 }]
      ]),
      pot: { amount: 150, confidence: 0.88 },
      buttons: { dealer: 'BTN', confidence: 0.92 },
      positions: { confidence: 0.9 },
      occlusion: new Map(),
      latency: {
        capture: 10,
        extraction: 20,
        total: 30
      }
    };

    return mockOutput;
  }

  async healthCheck(): Promise<boolean> {
    // Placeholder - would check gRPC service health
    return true;
  }
}