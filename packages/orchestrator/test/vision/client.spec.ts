import { describe, it, expect, afterEach } from 'vitest';
import {
  Server,
  ServerCredentials,
  status,
  type ServiceError,
} from '@grpc/grpc-js';
import { VisionClient } from '../../src/vision/client';
import { vision, visionGen } from '@poker-bot/shared';

const roi = { x: 0, y: 0, width: 10, height: 10 };

const layoutPack: vision.LayoutPack = {
  version: 'test',
  platform: 'test',
  theme: 'test',
  resolution: { width: 800, height: 600 },
  dpiCalibration: 1,
  cardROIs: [],
  stackROIs: {
    BTN: roi,
    SB: roi,
    BB: roi,
    UTG: roi,
    MP: roi,
    CO: roi,
  },
  potROI: roi,
  buttonROI: roi,
  actionButtonROIs: {
    fold: roi,
    check: roi,
    call: roi,
    raise: roi,
    bet: roi,
    allIn: roi,
  },
  turnIndicatorROI: roi,
  windowPatterns: { titleRegex: '.*', processName: 'test' },
};

const baseOutput: visionGen.VisionOutput = {
  timestamp: 123,
  cards: { holeCards: [], communityCards: [], confidence: 0.9 },
  stacks: {},
  pot: { amount: 100, confidence: 0.8 },
  buttons: { dealer: 'BTN', confidence: 0.7 },
  positions: { confidence: 0.6 },
  occlusion: {},
  actionButtons: undefined,
  turnState: undefined,
  latency: { capture: 1, extraction: 2, total: 3 },
};

const startVisionServer = async (
  captureHandler: visionGen.VisionServiceServer['captureFrame'],
  healthHandler?: visionGen.VisionServiceServer['healthCheck'],
) => {
  const server = new Server();
  server.addService(visionGen.VisionServiceService, {
    captureFrame: captureHandler,
    healthCheck:
      healthHandler ??
      ((_call, callback) => {
        callback(null, { healthy: true, message: 'ok' });
      }),
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync(
      '127.0.0.1:0',
      ServerCredentials.createInsecure(),
      (error, assignedPort) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(assignedPort);
      },
    );
  });

  return { server, address: `127.0.0.1:${port}` };
};

const shutdownServer = (server: Server) =>
  new Promise<void>((resolve) => {
    server.tryShutdown(() => resolve());
  });

describe('VisionClient Contract', () => {
  let client: VisionClient | undefined;
  let server: Server | undefined;

  afterEach(async () => {
    if (client) {
      client.close();
      client = undefined;
    }
    if (server) {
      await shutdownServer(server);
      server = undefined;
    }
  });

  it('parses a successful capture', async () => {
    let receivedLayout = '';
    const started = await startVisionServer((call, callback) => {
      receivedLayout = call.request.layoutJson;
      callback(null, baseOutput);
    });
    server = started.server;
    client = new VisionClient(started.address, layoutPack, 100);

    const result = await client.captureAndParse();
    expect(result.timestamp).toBe(123);
    expect(result.pot.amount).toBe(100);
    expect(result.buttons.dealer).toBe('BTN');
    expect(JSON.parse(receivedLayout).version).toBe('test');
  });

  it('times out when the server stalls', async () => {
    const started = await startVisionServer(() => {
      // Intentionally no callback to simulate a stalled request.
    });
    server = started.server;
    client = new VisionClient(started.address, layoutPack, 50);

    await expect(client.captureAndParse()).rejects.toThrow(/timed out/i);
  });

  it('propagates gRPC errors', async () => {
    const started = await startVisionServer((_call, callback) => {
      const error: ServiceError = Object.assign(
        new Error('vision offline'),
        { code: status.UNAVAILABLE },
      );
      callback(error, null as unknown as visionGen.VisionOutput);
    });
    server = started.server;
    client = new VisionClient(started.address, layoutPack, 100);

    await expect(client.captureAndParse()).rejects.toThrow('vision offline');
  });

  it('handles partial payload defaults', async () => {
    const partial: visionGen.VisionOutput = {
      timestamp: 0,
      cards: undefined,
      stacks: {},
      pot: undefined,
      buttons: undefined,
      positions: undefined,
      occlusion: {},
      actionButtons: undefined,
      turnState: undefined,
      latency: undefined,
    };
    const started = await startVisionServer((_call, callback) => {
      callback(null, partial);
    });
    server = started.server;
    client = new VisionClient(started.address, layoutPack, 100);

    const result = await client.captureAndParse();
    expect(result.cards.holeCards).toEqual([]);
    expect(result.pot.amount).toBe(0);
    expect(result.buttons.dealer).toBe('BTN');
  });

  it('recovers after transient failures', async () => {
    let attempts = 0;
    const started = await startVisionServer((_call, callback) => {
      attempts += 1;
      if (attempts === 1) {
        const error: ServiceError = Object.assign(
          new Error('temporary'),
          { code: status.UNAVAILABLE },
        );
        callback(error, null as unknown as visionGen.VisionOutput);
        return;
      }
      callback(null, baseOutput);
    });
    server = started.server;
    client = new VisionClient(started.address, layoutPack, 100);

    await expect(client.captureAndParse()).rejects.toThrow('temporary');
    const result = await client.captureAndParse();
    expect(result.pot.amount).toBe(100);
  });

  it('reports health check status', async () => {
    const started = await startVisionServer((_call, callback) => {
      callback(null, baseOutput);
    });
    server = started.server;
    client = new VisionClient(started.address, layoutPack, 100);

    await expect(client.healthCheck()).resolves.toBe(true);
  });
});
