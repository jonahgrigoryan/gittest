import { describe, it, expect, afterEach } from 'vitest';
import {
  Server,
  ServerCredentials,
  credentials,
  status,
  type ServiceError,
} from '@grpc/grpc-js';
import {
  createSolverClient,
  parseResponse,
  type SolverClientAdapter,
} from '../../src/solver_client/client';
import { solverGen } from '@poker-bot/shared';

const baseRequest: solverGen.SubgameRequest = {
  stateFingerprint: 'state-123',
  gameStateJson: '{}',
  budgetMs: 1000,
  effectiveStackBb: 100,
  actionSet: [],
};

const startSolverServer = async (
  solveHandler: solverGen.SolverServer['solve'],
) => {
  const server = new Server();
  server.addService(solverGen.SolverService, { solve: solveHandler });
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

describe('SolverClient Contract', () => {
  let client: SolverClientAdapter | undefined;
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

  it('returns a solver response', async () => {
    const response: solverGen.SubgameResponse = {
      actions: [
        { actionType: 'fold', amount: 0, frequency: 0.4, ev: 1, regret: 0 },
        { actionType: 'raise', amount: 150, frequency: 0.6, ev: 2, regret: 0 },
      ],
      exploitability: 0.12,
      computeTimeMs: 42,
      source: 'subgame',
    };
    const started = await startSolverServer((_call, callback) => {
      callback(null, response);
    });
    server = started.server;
    client = createSolverClient(started.address, credentials.createInsecure(), 100);

    const result = await client.solve(baseRequest);
    expect(result.exploitability).toBe(0.12);
    expect(result.actions).toHaveLength(2);
    expect(result.computeTimeMs).toBe(42);
  });

  it('times out when the server stalls', async () => {
    const started = await startSolverServer((_call, _callback) => {
      // Intentionally no callback to simulate a stalled request.
    });
    server = started.server;
    client = createSolverClient(started.address, credentials.createInsecure(), 50);

    await expect(client.solve(baseRequest)).rejects.toThrow(/timed out/i);
  });

  it('propagates server errors', async () => {
    const started = await startSolverServer((_call, callback) => {
      const error: ServiceError = Object.assign(new Error('unavailable'), {
        code: status.UNAVAILABLE,
      });
      callback(error, null as unknown as solverGen.SubgameResponse);
    });
    server = started.server;
    client = createSolverClient(started.address, credentials.createInsecure(), 100);

    await expect(client.solve(baseRequest)).rejects.toThrow('unavailable');
  });

  it('recovers after transient failures', async () => {
    let attempts = 0;
    const started = await startSolverServer((_call, callback) => {
      attempts += 1;
      if (attempts === 1) {
        const error: ServiceError = Object.assign(new Error('temporary'), {
          code: status.UNAVAILABLE,
        });
        callback(error, null as unknown as solverGen.SubgameResponse);
        return;
      }
      callback(null, {
        actions: [{ actionType: 'call', amount: 0, frequency: 1, ev: 0, regret: 0 }],
        exploitability: 0,
        computeTimeMs: 10,
        source: 'subgame',
      });
    });
    server = started.server;
    client = createSolverClient(started.address, credentials.createInsecure(), 100);

    await expect(client.solve(baseRequest)).rejects.toThrow('temporary');
    const result = await client.solve(baseRequest);
    expect(result.actions).toHaveLength(1);
  });

  it('defaults missing fields in parseResponse', () => {
    const result = parseResponse({ actions: [] } as solverGen.SubgameResponse);
    expect(result.actions).toEqual([]);
    expect(result.exploitability).toBe(0);
    expect(result.computeTimeMs).toBe(0);
    expect(result.source).toBe('subgame');
  });
});
