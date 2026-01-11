import fs from 'node:fs';
import { createParsedState } from '../../utils/factories';
import { serializeGameState } from '@poker-bot/shared';
import type { Position, GameState } from '@poker-bot/shared';

// Helper to create a record wrapper
function createRecord(serializedState: unknown, timestamp: number, handId: string): unknown {
  return {
    handId,
    timestamp,
    rawGameState: serializedState,
    metadata: { modelVersions: {} },
    sessionId: 'audit-session'
  };
}

const uniqueStacks = {
  'P1': 100,
  'P2': 100,
  'P3': 100,
  'P4': 100,
  'P5': 100,
  'P6': 100
};

function getRole(seatIndex: number, btnIndex: number): Position {
  const diff = (seatIndex - btnIndex + 6) % 6;
  switch (diff) {
    case 0: return 'BTN';
    case 1: return 'SB';
    case 2: return 'BB';
    case 3: return 'UTG';
    case 4: return 'MP';
    case 5: return 'CO';
    default: return 'BTN';
  }
}

export function generateAuditFixture(outputPath: string) {
  const seats = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
  const stacks = { ...uniqueStacks };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const records: any[] = [];
  let currentTime = Date.now();

  // --- SCENARIO A: Position Rotation ---
  // Hand 1: BTN at P1 (Index 0). Hero at P1 (BTN)
  let btnIndex = 0;
  let playersMap = new Map<Position, { stack: number }>();
  for (let i = 0; i < 6; i++) {
    const role = getRole(i, btnIndex);
    playersMap.set(role, { stack: stacks[seats[i] as keyof typeof stacks] });
  }
  let state = createParsedState({
    handId: 'hand-A1',
    street: 'preflop',
    pot: 3,
    players: playersMap,
    positions: {
      hero: 'BTN',
      button: 'BTN',
      smallBlind: 'SB',
      bigBlind: 'BB'
    },
    blinds: { small: 1, big: 2 }
  });
  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime, 'hand-A1'));
  currentTime += 60000; // 1 min gap

  // Hand 2: BTN at P2 (Index 1). Hero at P1. P1 is now CO relative to P2.
  btnIndex = 1;
  playersMap = new Map<Position, { stack: number }>();
  for (let i = 0; i < 6; i++) {
    const role = getRole(i, btnIndex);
    playersMap.set(role, { stack: stacks[seats[i] as keyof typeof stacks] });
  }
  state = createParsedState({
    handId: 'hand-A2',
    street: 'preflop',
    pot: 3,
    players: playersMap,
    positions: {
      hero: 'CO',
      button: 'BTN',
      smallBlind: 'SB',
      bigBlind: 'BB'
    },
    blinds: { small: 1, big: 2 }
  });
  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime, 'hand-A2'));
  currentTime += 60000;

  // Hand 3: BTN at P3 (Index 2). Hero at P1. P1 is now MP relative to P3.
  btnIndex = 2;
  playersMap = new Map<Position, { stack: number }>();
  for (let i = 0; i < 6; i++) {
    const role = getRole(i, btnIndex);
    playersMap.set(role, { stack: stacks[seats[i] as keyof typeof stacks] });
  }
  state = createParsedState({
    handId: 'hand-A3',
    street: 'preflop',
    pot: 3,
    players: playersMap,
    positions: {
      hero: 'MP',
      button: 'BTN',
      smallBlind: 'SB',
      bigBlind: 'BB'
    },
    blinds: { small: 1, big: 2 }
  });
  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime, 'hand-A3'));
  currentTime += 60000;

  // --- SCENARIO B: Rapid Hands ---
  // Hand B1
  state = createParsedState({
    handId: 'hand-B1',
    street: 'river',
    pot: 50,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: 1, big: 2 }
  });
  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime, 'hand-B1'));

  // Hand B2 - only 100ms later
  currentTime += 100;
  state = createParsedState({
    handId: 'hand-B2',
    street: 'preflop',
    pot: 3, // Pot reset
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: 1, big: 2 }
  });
  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime, 'hand-B2'));
  currentTime += 60000;

  // --- SCENARIO C: State Sync (Frame Deltas) ---
  // Frame C1: Normal
  state = createParsedState({
    handId: 'hand-C1',
    street: 'flop',
    pot: 10,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: 1, big: 2 }
  });
  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime, 'hand-C1'));
  currentTime += 1000;

  // Frame C2: Pot Decrease (Impossible within same hand)
  state = createParsedState({
    handId: 'hand-C1',
    street: 'flop',
    pot: 5, // Decreased from 10
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: 1, big: 2 }
  });
  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime, 'hand-C1'));

  const content = records.map(r => JSON.stringify(r)).join('\n');
  fs.writeFileSync(outputPath, content);
  console.log(`Generated ${records.length} records to ${outputPath}`);
}
