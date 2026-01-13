import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { readHandRecords } from '../../src/replay/reader';
import { deserializeGameState } from '../../src/replay/deserialize';
import { StateSyncTracker } from '../../src/vision/state-sync';
import { generateAuditFixture } from './fixtures/generate_audit_fixture';
import type { HandRecord, GameState, Position } from '@poker-bot/shared';

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const FIXTURE_PATH = path.join(FIXTURE_DIR, 'audit-session-phase6.jsonl');

describe('Phase 6: Player/Table State Audit', () => {
  beforeAll(() => {
    if (!fs.existsSync(FIXTURE_DIR)) {
      fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    }
    generateAuditFixture(FIXTURE_PATH);
  });

  afterAll(() => {
    if (fs.existsSync(FIXTURE_PATH)) {
      fs.unlinkSync(FIXTURE_PATH);
    }
  });

  it('A) Position / seat mapping stability (Rotation)', async () => {
    const records: HandRecord[] = [];
    for await (const record of readHandRecords(FIXTURE_PATH)) {
      if (record.handId.startsWith('hand-A')) {
        records.push(record);
      }
    }

    // We expect 3 hands (A1, A2, A3)
    // Filter to get the first frame of each hand to check initial positions
    const handStarts = records.filter((r, i, arr) => i === 0 || r.handId !== arr[i-1].handId);
    expect(handStarts.length).toBe(3);

    const h1 = deserializeGameState(handStarts[0].rawGameState);
    const h2 = deserializeGameState(handStarts[1].rawGameState);
    const h3 = deserializeGameState(handStarts[2].rawGameState);

    // Hand 1: BTN at P1 (Index 0), Hero at P1 -> Hero is BTN
    expect(h1.positions.hero).toBe('BTN');
    expect(h1.positions.button).toBe('BTN');

    // Hand 2: BTN at P2 (Index 1), Hero at P1 -> Hero is CO
    expect(h2.positions.hero).toBe('CO');
    
    // Hand 3: BTN at P3 (Index 2), Hero at P1 -> Hero is MP
    expect(h3.positions.hero).toBe('MP');
  });

  it('B) Stack delta integrity (Phantom Chips)', async () => {
    const records: HandRecord[] = [];
    for await (const record of readHandRecords(FIXTURE_PATH)) {
      if (record.handId.startsWith('hand-B')) {
        records.push(record);
      }
    }
    expect(records.length).toBe(2);

    const tracker = new StateSyncTracker();
    
    // Frame 1: Normal
    const s1 = deserializeGameState(records[0].rawGameState);
    // Mock ParsedGameState structure as StateSyncTracker expects it
    const p1 = { ...s1, parseErrors: [], missingElements: [], inferredValues: {} } as any;
    tracker.addFrame(p1);
    expect(tracker.detectInconsistencies(p1)).toEqual([]);

    // Frame 2: Stack increases without pot win
    const s2 = deserializeGameState(records[1].rawGameState);
    const p2 = { ...s2, parseErrors: [], missingElements: [], inferredValues: {} } as any;
    
    const errors = tracker.detectInconsistencies(p2);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('Stack increased unexpectedly'))).toBe(true);
  });

  it('C) Pot monotonicity (Pot Leak)', async () => {
    const records: HandRecord[] = [];
    for await (const record of readHandRecords(FIXTURE_PATH)) {
      if (record.handId.startsWith('hand-C')) {
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
  });

  it('D) Blind posting correctness (Double Posting / Stack Leak)', async () => {
    const records: HandRecord[] = [];
    for await (const record of readHandRecords(FIXTURE_PATH)) {
      if (record.handId.startsWith('hand-D')) {
        records.push(record);
      }
    }
    expect(records.length).toBe(2);

    const s1 = deserializeGameState(records[0].rawGameState);
    const s2 = deserializeGameState(records[1].rawGameState);

    // Invariant: Sum of all stacks + Pot should be constant (if no rake/rebuy)
    // Or simpler: Delta(TotalStacks) + Delta(Pot) = 0
    
    const totalStack1 = Array.from(s1.players.values()).reduce((sum, p) => sum + p.stack, 0);
    const totalStack2 = Array.from(s2.players.values()).reduce((sum, p) => sum + p.stack, 0);
    
    const potDelta = s2.pot - s1.pot;
    const stackDelta = totalStack2 - totalStack1;

    // In Hand D, SB stack drops by SB_AMT, but Pot stays same.
    // So stackDelta is -SB_AMT, potDelta is 0.
    // Sum is -SB_AMT != 0.
    
    const conservationError = Math.abs(stackDelta + potDelta);
    
    // We expect this to fail conservation check
    expect(conservationError).toBeGreaterThan(0.01);

    // This proves we can detect "Chips disappearing" (e.g. double blind posting logic where chips vanish)
    // If we want to enforce this as a system invariant, we should add it to StateSyncTracker.
    // For now, this test confirms we can detect it.
  });
});
