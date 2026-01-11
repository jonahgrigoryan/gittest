import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { readHandRecords } from '../../src/replay/reader';
import { deserializeGameState } from '../../src/replay/deserialize';
import { StateSyncTracker } from '../../src/vision/state-sync';
import { generateFixture } from './fixtures/generate_fixture';
import type { HandRecord, Position } from '@poker-bot/shared';

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const FIXTURE_PATH = path.join(FIXTURE_DIR, 'cash-session.jsonl');

describe('Cash Game Validation (Phase 3)', () => {
  beforeAll(() => {
    // Ensure fixture exists
    if (!fs.existsSync(FIXTURE_DIR)) {
      fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    }
    generateFixture(FIXTURE_PATH);
  });

  afterAll(() => {
    // Cleanup generated fixture to keep working tree clean
    if (fs.existsSync(FIXTURE_PATH)) {
      fs.unlinkSync(FIXTURE_PATH);
    }
  });

  it('validates state correctness and invariants across sequential hands', async () => {
    const records: HandRecord[] = [];
    for await (const record of readHandRecords(FIXTURE_PATH)) {
      records.push(record);
    }

    expect(records.length).toBe(3);

    const tracker = new StateSyncTracker();

    for (const [index, record] of records.entries()) {
      const state = deserializeGameState(record.rawGameState);

      // Cast to any to satisfy StateSyncTracker which expects ParsedGameState
      const parsedState = { ...state, parseErrors: [], missingElements: [], inferredValues: {} } as any;

      const errors = tracker.detectInconsistencies(parsedState);
      tracker.addFrame(parsedState);

      expect(errors, `Inconsistencies found in hand ${index + 1}`).toEqual([]);

      // Validate Position Rotation
      if (index === 0) {
        expect(state.positions.hero).toBe('BTN');
      } else if (index === 1) {
        expect(state.positions.hero).toBe('CO');
      } else if (index === 2) {
        expect(state.positions.hero).toBe('MP');
      }

      // Validate Blinds
      expect(state.blinds.small).toBe(1);
      expect(state.blinds.big).toBe(2);

      // Validate Stacks
      for (const [pos, player] of state.players.entries()) {
        expect(player.stack).toBeGreaterThanOrEqual(0);
      }

      // Validate Pot
      expect(state.pot).toBe(3);
    }
  });

  it('validates stack updates reflect game outcomes', async () => {
    const records: HandRecord[] = [];
    for await (const record of readHandRecords(FIXTURE_PATH)) {
      records.push(record);
    }

    const h1 = deserializeGameState(records[0].rawGameState);
    const h2 = deserializeGameState(records[1].rawGameState);
    const h3 = deserializeGameState(records[2].rawGameState);

    // Check P2 stack change H1 -> H2
    const p2_h1 = h1.players.get('SB')?.stack;
    const p2_h2 = h2.players.get('BTN')?.stack;
    expect(p2_h2).toBe((p2_h1 ?? 0) - 1);

    // Check P3 stack change H1 -> H2
    const p3_h1 = h1.players.get('BB')?.stack;
    const p3_h2 = h2.players.get('SB')?.stack;
    expect(p3_h2).toBe((p3_h1 ?? 0) + 1);

    // Check P3 stack change H2 -> H3
    const p3_h3 = h3.players.get('BTN')?.stack;
    expect(p3_h3).toBe((p3_h2 ?? 0) + 2);
  });
});
