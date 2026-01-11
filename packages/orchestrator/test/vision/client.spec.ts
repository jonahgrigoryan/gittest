import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VisionClient } from '../../src/vision/client';
import * as Shared from '@poker-bot/shared';

// Hoist mocks so they are available in vi.mock factory
const mocks = vi.hoisted(() => ({
  captureFrame: vi.fn(),
  healthCheck: vi.fn(),
  close: vi.fn(),
}));

// Apply the mock
vi.mock('@poker-bot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof Shared>();
  return {
    ...actual,
    visionGen: {
      ...actual.visionGen,
      VisionServiceClient: vi.fn(() => ({
        captureFrame: mocks.captureFrame,
        healthCheck: mocks.healthCheck,
        close: mocks.close,
      })),
    },
  };
});

describe('VisionClient Contract', () => {
  let client: VisionClient;
  const serviceUrl = 'localhost:50051';
  const layoutPack: any = { name: 'test', width: 800, height: 600, regions: [] };

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.captureFrame.mockReset();
    mocks.healthCheck.mockReset();
    mocks.close.mockReset();
    // Re-instantiate client for each test
    client = new VisionClient(serviceUrl, layoutPack);
  });

  afterEach(() => {
    vi.useRealTimers();
    client.close();
  });

  it('should handle successful response', async () => {
    const mockResponse = {
      timestamp: 1234567890,
      cards: { holeCards: [], communityCards: [] },
      stacks: {},
      pot: { amount: 100 },
      buttons: { dealer: 'BTN' },
      positions: {},
      occlusion: {},
      actionButtons: {},
      turnState: { isHeroTurn: true },
      latency: { total: 10 }
    };

    mocks.captureFrame.mockImplementation((req: any, cb: any) => {
      cb(null, mockResponse);
    });

    const result = await client.captureAndParse();
    expect(result).toBeDefined();
    expect(result.timestamp).toBe(1234567890);
    expect(result.pot.amount).toBe(100);
  });

  it('should enforce timeout (client-side)', async () => {
    // Simulate hanging request by never calling the callback
    mocks.captureFrame.mockImplementation((req: any, cb: any) => {
      // Do nothing
    });

    const promise = client.captureAndParse();
    
    // Advance time by 5000ms (default timeout we expect/will implement)
    vi.advanceTimersByTime(5000);

    await expect(promise).rejects.toThrow(/timeout/i);
  });

  it('should handle gRPC errors gracefully', async () => {
    const error = new Error('Connection failed');
    mocks.captureFrame.mockImplementation((req: any, cb: any) => {
      cb(error, null);
    });

    await expect(client.captureAndParse()).rejects.toThrow('Connection failed');
  });

  it('should handle empty/null result', async () => {
    mocks.captureFrame.mockImplementation((req: any, cb: any) => {
      cb(null, null);
    });

    await expect(client.captureAndParse()).rejects.toThrow(/empty result/i);
  });

  it('should handle malformed/partial payload safely', async () => {
    // Missing optional fields should not crash
    const partialResponse = {
      // No timestamp, no cards, etc.
    };

    mocks.captureFrame.mockImplementation((req: any, cb: any) => {
      cb(null, partialResponse);
    });

    const result = await client.captureAndParse();
    expect(result).toBeDefined();
    // Should use defaults
    expect(result.cards.holeCards).toEqual([]);
    expect(result.pot.amount).toBe(0);
  });
});
