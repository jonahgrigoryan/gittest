import { describe, it, expect, vi } from 'vitest';
import { HealthMonitor } from '../../src/health/monitor';
import type { HealthMonitoringConfig } from '@poker-bot/shared';

describe('HealthMonitor Error Handling', () => {
  it('should report failed status when check throws', async () => {
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    const config: HealthMonitoringConfig = {
      intervalMs: 1000,
      dashboard: { enabled: false, port: 0 },
      safeMode: { enabled: false },
      panicStop: { enabled: false },
      degradedThresholds: { visionConfidenceMin: 0, solverLatencyMs: 0, executorFailureRate: 0 }
    };

    const monitor = new HealthMonitor(config, { logger: mockLogger });

    monitor.registerCheck({
      name: 'failing-check',
      fn: async () => {
        throw new Error('Check failed');
      }
    });

    // Trigger check execution
    // @ts-expect-error - accessing private method for testing
    await monitor.runChecks();

    const snapshot = monitor.getLatestSnapshot();
    expect(snapshot).toBeDefined();
    expect(snapshot?.overall).toBe('failed');
    
    const failedStatus = snapshot?.statuses.find(s => s.component === 'failing-check');
    expect(failedStatus).toBeDefined();
    expect(failedStatus?.state).toBe('failed');
    expect(failedStatus?.details).toBe('Check failed');
    
    // Verify logging
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Health check failed'),
      expect.objectContaining({ component: 'failing-check', error: expect.any(Error) })
    );
  });
});
