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
    sessionId: 'audit-session-phase6'
  };
}

const STARTING_STACK = 100;
const SB_AMT = 0.5;
const BB_AMT = 1.0;

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const records: any[] = [];
  let currentTime = Date.now();

  // --- SCENARIO A: Happy Path (3 Hands) ---
  // Verify: BTN rotation, Blind Posting, Stack/Pot Integrity

  // Hand A1: BTN at P1 (Index 0)
  // P2=SB, P3=BB. 
  // Initial state: Preflop, blinds posted.
  let btnIndex = 0;
  let playersMap = new Map<Position, { stack: number }>();
  
  // Setup stacks for Hand A1 start
  // SB (P2) posts 0.5, BB (P3) posts 1.0
  for (let i = 0; i < 6; i++) {
    const role = getRole(i, btnIndex);
    let stack = STARTING_STACK;
    if (role === 'SB') stack -= SB_AMT;
    if (role === 'BB') stack -= BB_AMT;
    playersMap.set(role, { stack });
  }

  let state = createParsedState({
    handId: 'hand-A1',
    street: 'preflop',
    pot: SB_AMT + BB_AMT,
    players: playersMap,
    positions: {
      hero: 'BTN',
      button: 'BTN',
      smallBlind: 'SB',
      bigBlind: 'BB'
    },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime, 'hand-A1'));
  currentTime += 5000;

  // Hand A1: Action - BTN (Hero) Raises to 2.5BB
  // P1 stack decreases by 2.5, Pot increases by 2.5
  playersMap = new Map(playersMap);
  const btnStack = playersMap.get('BTN')!.stack - 2.5;
  playersMap.set('BTN', { stack: btnStack });
  
  state = createParsedState({
    handId: 'hand-A1',
    street: 'preflop',
    pot: SB_AMT + BB_AMT + 2.5,
    players: playersMap,
    positions: {
      hero: 'BTN',
      button: 'BTN',
      smallBlind: 'SB',
      bigBlind: 'BB'
    },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime, 'hand-A1'));
  currentTime += 60000;


  // Hand A2: BTN at P2 (Index 1)
  // P3=SB, P4=BB.
  // Previous hand finished, stacks reset (simplified for fixture, assuming reload or just new hand state)
  // Let's assume everyone reloaded to 100 for simplicity of checking "exactly one blind posting"
  btnIndex = 1;
  playersMap = new Map();
  for (let i = 0; i < 6; i++) {
    const role = getRole(i, btnIndex);
    let stack = STARTING_STACK;
    if (role === 'SB') stack -= SB_AMT;
    if (role === 'BB') stack -= BB_AMT;
    playersMap.set(role, { stack });
  }

  state = createParsedState({
    handId: 'hand-A2',
    street: 'preflop',
    pot: SB_AMT + BB_AMT,
    players: playersMap,
    positions: {
      hero: 'CO', // P1 is CO relative to P2 BTN
      button: 'BTN',
      smallBlind: 'SB',
      bigBlind: 'BB'
    },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime, 'hand-A2'));
  currentTime += 60000;

  // Hand A3: BTN at P3 (Index 2). Hero at P1. P1 is now MP relative to P3.
  btnIndex = 2;
  playersMap = new Map();
  for (let i = 0; i < 6; i++) {
    const role = getRole(i, btnIndex);
    let stack = STARTING_STACK;
    if (role === 'SB') stack -= SB_AMT;
    if (role === 'BB') stack -= BB_AMT;
    playersMap.set(role, { stack });
  }
  state = createParsedState({
    handId: 'hand-A3',
    street: 'preflop',
    pot: SB_AMT + BB_AMT,
    players: playersMap,
    positions: {
      hero: 'MP',
      button: 'BTN',
      smallBlind: 'SB',
      bigBlind: 'BB'
    },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime, 'hand-A3'));
  currentTime += 60000;


  // --- SCENARIO B: Phantom Chips (Bad) ---
  // Stack increases without pot win
  // Hand B1
  btnIndex = 0;
  playersMap = new Map();
  // Base state
  for (let i = 0; i < 6; i++) {
    const role = getRole(i, btnIndex);
    playersMap.set(role, { stack: STARTING_STACK });
  }
  
  // Frame 1: Normal
  state = createParsedState({
    handId: 'hand-B1',
    street: 'flop',
    pot: 10,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime, 'hand-B1'));
  currentTime += 1000;

  // Frame 2: BTN stack jumps +5, Pot same
  playersMap = new Map(playersMap);
  playersMap.set('BTN', { stack: STARTING_STACK + 5 });
  
  state = createParsedState({
    handId: 'hand-B1',
    street: 'flop',
    pot: 10,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime, 'hand-B1'));
  currentTime += 60000;


  // --- SCENARIO C: Pot Leak (Bad) ---
  // Pot decreases mid-hand
  // Hand C1
  playersMap = new Map();
  for (let i = 0; i < 6; i++) {
    const role = getRole(i, btnIndex);
    playersMap.set(role, { stack: STARTING_STACK });
  }

  // Frame 1: Pot 20
  state = createParsedState({
    handId: 'hand-C1',
    street: 'turn',
    pot: 20,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime, 'hand-C1'));
  currentTime += 1000;

  // Frame 2: Pot 15 (Leak)
  state = createParsedState({
    handId: 'hand-C1',
    street: 'turn',
    pot: 15,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime, 'hand-C1'));
  currentTime += 60000;


  // --- SCENARIO D: Double Blind Posting (Bad) ---
  // SB stack drops by 2x SB amount in one frame transition or cumulative
  // Hand D1
  btnIndex = 0;
  playersMap = new Map();
  // Start with SB posted once
  for (let i = 0; i < 6; i++) {
    const role = getRole(i, btnIndex);
    let stack = STARTING_STACK;
    if (role === 'SB') stack -= SB_AMT;
    if (role === 'BB') stack -= BB_AMT;
    playersMap.set(role, { stack });
  }

  // Frame 1: Normal Preflop
  state = createParsedState({
    handId: 'hand-D1',
    street: 'preflop',
    pot: SB_AMT + BB_AMT,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime, 'hand-D1'));
  currentTime += 1000;

  // Frame 2: SB stack drops ANOTHER SB amount, Pot increases by SB amount
  // This looks like a valid bet, but if it's forced blind logic, it might be double posting.
  // However, for the audit, we want to detect if the *blind* logic is applied twice.
  // If we just see stack decrease, it could be a call.
  // To simulate "Double Posting" as a state error, we might show stack decrease WITHOUT pot increase (lost chips)
  // OR stack decrease + pot increase but no action taken.
  // Let's simulate: Stack drops by SB, Pot stays same (Chips vanished into void? Or just mismatch)
  // Actually, "Double Posting" usually means the bot *thinks* it needs to post again.
  // For a state audit, we are checking the *record*.
  // Let's simulate: SB Stack = Start - 2*SB, Pot = SB + BB. (Chips missing from stack, not in pot)
  
  playersMap = new Map(playersMap);
  const sbStack = playersMap.get('SB')!.stack - SB_AMT;
  playersMap.set('SB', { stack: sbStack });

  state = createParsedState({
    handId: 'hand-D1',
    street: 'preflop',
    pot: SB_AMT + BB_AMT, // Pot didn't increase!
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(serializeGameState(state as unknown as GameState), currentTime, 'hand-D1'));


  const content = records.map(r => JSON.stringify(r)).join('\n');
  fs.writeFileSync(outputPath, content);
  console.log(`Generated ${records.length} records to ${outputPath}`);
}
