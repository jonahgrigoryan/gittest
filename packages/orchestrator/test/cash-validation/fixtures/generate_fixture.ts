import fs from 'node:fs';
import path from 'node:path';
import { createParsedState } from '../../utils/factories';
import { serializeGameState } from '@poker-bot/shared';
import type { Position, GameState } from '@poker-bot/shared';

// Helper to create a record wrapper
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createRecord(serializedState: any, timestamp: number): any {
  return {
    handId: serializedState.handId,
    timestamp,
    rawGameState: serializedState,
    metadata: { modelVersions: {} },
    sessionId: 'cash-validation-session'
  };
}

const uniqueStacks = {
  'P1': 101,
  'P2': 102,
  'P3': 103,
  'P4': 104,
  'P5': 105,
  'P6': 106
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

export function generateFixture(outputPath: string) {
  const seats = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
  const stacks = { ...uniqueStacks };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const records: any[] = [];
  let currentTime = Date.now();

  // --- HAND 1 ---
  let btnIndex = 0;
  let handId = 'hand-1';

  let playersMap = new Map<Position, { stack: number }>();
  for (let i = 0; i < 6; i++) {
    const role = getRole(i, btnIndex);
    playersMap.set(role, { stack: stacks[seats[i]] });
  }

  let state = createParsedState({
    handId,
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

  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime));
  currentTime += 1000;

  stacks['P2'] -= 1;
  stacks['P3'] += 1;

  // --- HAND 2 ---
  btnIndex = 1;
  handId = 'hand-2';

  playersMap = new Map<Position, { stack: number }>();
  for (let i = 0; i < 6; i++) {
    const role = getRole(i, btnIndex);
    playersMap.set(role, { stack: stacks[seats[i]] });
  }

  state = createParsedState({
    handId,
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

  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime));
  currentTime += 1000;

  stacks['P3'] += 2;
  stacks['P4'] -= 2;

  // --- HAND 3 ---
  btnIndex = 2;
  handId = 'hand-3';

  playersMap = new Map<Position, { stack: number }>();
  for (let i = 0; i < 6; i++) {
    const role = getRole(i, btnIndex);
    playersMap.set(role, { stack: stacks[seats[i]] });
  }

  state = createParsedState({
    handId,
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

  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime));

  const content = records.map(r => JSON.stringify(r)).join('\n');
  fs.writeFileSync(outputPath, content);
  console.log(`Generated ${records.length} records to ${outputPath}`);
}

// Execute if running directly
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const OUTPUT_PATH = path.join(__dirname, 'cash-session.jsonl');
  generateFixture(OUTPUT_PATH);
}
