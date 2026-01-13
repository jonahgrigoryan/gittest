import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { readHandRecords } from '../../src/replay/reader';
import { deserializeGameState } from '../../src/replay/deserialize';
import { StateSyncTracker } from '../../src/vision/state-sync';
import { generateGoldenFixture } from './fixtures/generate_golden_fixture';
import type { HandRecord } from '@poker-bot/shared';

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const FIXTURE_PATH = path.join(FIXTURE_DIR, 'golden-replay-session.jsonl');

describe('Phase 7: Golden Replay Pack Regression Gate', () => {
  beforeAll(() => {
    if (!fs.existsSync(FIXTURE_DIR)) {
      fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    }
    generateGoldenFixture(FIXTURE_PATH);
  });

  afterAll(() => {
    if (fs.existsSync(FIXTURE_PATH)) {
      fs.unlinkSync(FIXTURE_PATH);
    }
  });

  it('G01: Seat Wobble (Player sits out then returns)', async () => {
    const records: HandRecord[] = [];
    for await (const record of readHandRecords(FIXTURE_PATH)) {
      if (record.handId.startsWith('hand-G01')) {
        records.push(record);
      }
    }
    expect(records.length).toBe(3);

    const tracker = new StateSyncTracker();

    // Frame 1: Full table
    const s1 = deserializeGameState(records[0].rawGameState);
    const p1 = { ...s1, parseErrors: [], missingElements: [], inferredValues: {} } as any;
    expect(tracker.detectInconsistencies(p1)).toEqual([]);
    tracker.addFrame(p1);

    // Frame 2: UTG Missing
    const s2 = deserializeGameState(records[1].rawGameState);
    const p2 = { ...s2, parseErrors: [], missingElements: [], inferredValues: {} } as any;

    // Should report missing player
    const errors = tracker.detectInconsistencies(p2);
    expect(errors.some(e => e.includes('Player at UTG missing'))).toBe(true);
    tracker.addFrame(p2);

    // Frame 3: UTG Returns
    const s3 = deserializeGameState(records[2].rawGameState);
    const p3 = { ...s3, parseErrors: [], missingElements: [], inferredValues: {} } as any;
    // Returning player is fine, no error expected as previous frame didn't have UTG to compare stack against
    const errors3 = tracker.detectInconsistencies(p3);
    expect(errors3).toEqual([]);
    tracker.addFrame(p3);
  });

  it('G02: Rapid Hand Transitions (< 1s between hands)', async () => {
    const records: HandRecord[] = [];
    for await (const record of readHandRecords(FIXTURE_PATH)) {
      if (record.handId.startsWith('hand-G02')) {
        records.push(record);
      }
    }
    expect(records.length).toBe(2);

    const t1 = records[0].createdAt;
    const t2 = records[1].createdAt;
    const diff = t2 - t1;

    expect(diff).toBeLessThan(1000);

    const tracker = new StateSyncTracker();
    const s1 = deserializeGameState(records[0].rawGameState);
    const p1 = { ...s1, parseErrors: [], missingElements: [], inferredValues: {} } as any;
    tracker.addFrame(p1);

    const s2 = deserializeGameState(records[1].rawGameState);
    const p2 = { ...s2, parseErrors: [], missingElements: [], inferredValues: {} } as any;

    // New hand detected -> History cleared -> No errors (Clean Reset)
    const errors = tracker.detectInconsistencies(p2);
    expect(errors).toEqual([]);
    tracker.addFrame(p2);
  });

  it('G04: Position Drift (BTN marker moves unexpectedly)', async () => {
    const records: HandRecord[] = [];
    for await (const record of readHandRecords(FIXTURE_PATH)) {
      if (record.handId.startsWith('hand-G04')) {
        records.push(record);
      }
    }
    expect(records.length).toBe(2);

    const tracker = new StateSyncTracker();

    // Frame 1: BTN at P0
    const s1 = deserializeGameState(records[0].rawGameState);
    const p1 = { ...s1, parseErrors: [], missingElements: [], inferredValues: {} } as any;
    tracker.addFrame(p1);

    // Frame 2: BTN moves to P1 (SB role) unexpectedly
    const s2 = deserializeGameState(records[1].rawGameState);
    const p2 = { ...s2, parseErrors: [], missingElements: [], inferredValues: {} } as any;

    const errors = tracker.detectInconsistencies(p2);
    expect(errors.some(e => e.includes('Button moved unexpectedly'))).toBe(true);
    tracker.addFrame(p2);
  });

  it('G05: Phantom Chips (Stack increases without pot decrease)', async () => {
    const records: HandRecord[] = [];
    for await (const record of readHandRecords(FIXTURE_PATH)) {
      if (record.handId.startsWith('hand-G05')) {
        records.push(record);
      }
    }
    expect(records.length).toBe(2);

    const tracker = new StateSyncTracker();

    // Frame 1: Normal
    const s1 = deserializeGameState(records[0].rawGameState);
    const p1 = { ...s1, parseErrors: [], missingElements: [], inferredValues: {} } as any;
    tracker.addFrame(p1);

    // Frame 2: Stack increases without pot win
    const s2 = deserializeGameState(records[1].rawGameState);
    const p2 = { ...s2, parseErrors: [], missingElements: [], inferredValues: {} } as any;

    const errors = tracker.detectInconsistencies(p2);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('Stack increased unexpectedly'))).toBe(true);
    tracker.addFrame(p2);
  });

  it('G06: Pot Leak (Pot decreases mid-hand)', async () => {
    const records: HandRecord[] = [];
    for await (const record of readHandRecords(FIXTURE_PATH)) {
      if (record.handId.startsWith('hand-G06')) {
        records.push(record);
      }
    }
    expect(records.length).toBe(2);

    const tracker = new StateSyncTracker();

    // Frame 1: Pot 20
    const s1 = deserializeGameState(records[0].rawGameState);
    const p1 = { ...s1, parseErrors: [], missingElements: [], inferredValues: {} } as any;
    tracker.addFrame(p1);

    // Frame 2: Pot 15
    const s2 = deserializeGameState(records[1].rawGameState);
    const p2 = { ...s2, parseErrors: [], missingElements: [], inferredValues: {} } as any;

    const errors = tracker.detectInconsistencies(p2);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('Pot decreased'))).toBe(true);
    tracker.addFrame(p2);
  });

  it('G08: Stack Reload Mid-Session', async () => {
    const records: HandRecord[] = [];
    for await (const record of readHandRecords(FIXTURE_PATH)) {
      if (record.handId.startsWith('hand-G08')) {
        records.push(record);
      }
    }
    expect(records.length).toBe(2);

    const tracker = new StateSyncTracker();

    // Hand A: Low stack
    const s1 = deserializeGameState(records[0].rawGameState);
    const p1 = { ...s1, parseErrors: [], missingElements: [], inferredValues: {} } as any;
    tracker.addFrame(p1);

    // Hand B: Reloaded stack (New Hand)
    const s2 = deserializeGameState(records[1].rawGameState);
    const p2 = { ...s2, parseErrors: [], missingElements: [], inferredValues: {} } as any;

    // New hand -> clean reset
    const errors = tracker.detectInconsistencies(p2);
    expect(errors).toEqual([]);
    tracker.addFrame(p2);
  });

  it('G10: Blind Posting Edge Case (Partial stack)', async () => {
    const records: HandRecord[] = [];
    for await (const record of readHandRecords(FIXTURE_PATH)) {
      if (record.handId.startsWith('hand-G10')) {
        records.push(record);
      }
    }
    expect(records.length).toBe(2);

    const tracker = new StateSyncTracker();
    const s1 = deserializeGameState(records[0].rawGameState);
    const p1 = { ...s1, parseErrors: [], missingElements: [], inferredValues: {} } as any;
    tracker.addFrame(p1);

    const s2 = deserializeGameState(records[1].rawGameState);
    const p2 = { ...s2, parseErrors: [], missingElements: [], inferredValues: {} } as any;

    // Should accept partial blind posting (all-in)
    const errors = tracker.detectInconsistencies(p2);
    expect(errors).toEqual([]);
    tracker.addFrame(p2);
  });

  it('G11: Street Transition Under Pressure', async () => {
    const records: HandRecord[] = [];
    for await (const record of readHandRecords(FIXTURE_PATH)) {
      if (record.handId.startsWith('hand-G11')) {
        records.push(record);
      }
    }
    expect(records.length).toBe(3);

    const tracker = new StateSyncTracker();

    // Flop
    const s1 = deserializeGameState(records[0].rawGameState);
    const p1 = { ...s1, parseErrors: [], missingElements: [], inferredValues: {} } as any;
    tracker.addFrame(p1);

    // Turn (100ms later)
    const s2 = deserializeGameState(records[1].rawGameState);
    const p2 = { ...s2, parseErrors: [], missingElements: [], inferredValues: {} } as any;
    let errors = tracker.detectInconsistencies(p2);
    expect(errors).toEqual([]);
    tracker.addFrame(p2); // Add frame so next comparison is valid

    // River (100ms later)
    const s3 = deserializeGameState(records[2].rawGameState);
    const p3 = { ...s3, parseErrors: [], missingElements: [], inferredValues: {} } as any;
    errors = tracker.detectInconsistencies(p3);
    expect(errors).toEqual([]);
    tracker.addFrame(p3);
  });
});
