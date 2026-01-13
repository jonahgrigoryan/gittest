import fs from 'node:fs';
import { createParsedState } from '../../utils/factories';
import { serializeGameState } from '@poker-bot/shared';
import type {
  Action,
  GameState,
  HandRecord,
  Position,
  SerializedStrategyDecision,
  StrategyTimingBreakdown
} from '@poker-bot/shared';

const SESSION_ID = 'golden-replay-session';
const CONFIG_HASH = 'golden-replay';
const BASE_TIMING: StrategyTimingBreakdown = {
  gtoTime: 0,
  agentTime: 0,
  synthesisTime: 0,
  totalTime: 0
};

function createDecision(state: GameState, rngSeed: number): SerializedStrategyDecision {
  const action: Action = {
    type: 'check',
    position: state.positions.hero,
    street: state.street
  };

  return {
    action,
    reasoning: {
      gtoRecommendation: [],
      agentRecommendation: [],
      blendedDistribution: [],
      alpha: 1,
      divergence: 0,
      riskCheckPassed: true,
      sizingQuantized: true
    },
    timing: { ...BASE_TIMING },
    metadata: {
      rngSeed,
      configHash: CONFIG_HASH
    }
  };
}

function createRecord(state: GameState, createdAt: number, rngSeed: number): HandRecord {
  const rawGameState = serializeGameState(state);

  return {
    handId: state.handId,
    sessionId: SESSION_ID,
    createdAt,
    rawGameState,
    decision: createDecision(state, rngSeed),
    timing: { ...BASE_TIMING },
    metadata: {
      configHash: CONFIG_HASH,
      rngSeed,
      redactionApplied: false,
      modelVersions: {}
    }
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

export function generateGoldenFixture(outputPath: string) {
  const records: HandRecord[] = [];
  let currentTime = 1700000000000;
  let rngSeed = 9000;

  // --- G01: Seat Wobble ---
  // Player sits out then returns mid-session
  let btnIndex = 0;
  let playersMap = new Map<Position, { stack: number }>();
  for (let i = 0; i < 6; i++) {
    const role = getRole(i, btnIndex);
    playersMap.set(role, { stack: STARTING_STACK });
  }

  // Frame 1: Full table
  let state = createParsedState({
    handId: 'hand-G01',
    street: 'preflop',
    pot: SB_AMT + BB_AMT,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  rngSeed += 1;
  currentTime += 2000;

  // Frame 2: UTG disappears
  let playersMapMissing = new Map(playersMap);
  playersMapMissing.delete('UTG');
  state = createParsedState({
    handId: 'hand-G01',
    street: 'preflop',
    pot: SB_AMT + BB_AMT,
    players: playersMapMissing,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  rngSeed += 1;
  currentTime += 2000;

  // Frame 3: UTG returns
  state = createParsedState({
    handId: 'hand-G01',
    street: 'preflop',
    pot: SB_AMT + BB_AMT,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  rngSeed += 1;
  currentTime += 60000;


  // --- G02: Rapid Hand Transitions ---
  // < 1s between consecutive hands
  // Hand G02-A
  state = createParsedState({
    handId: 'hand-G02-A',
    street: 'river',
    pot: 50,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  rngSeed += 1;
  currentTime += 500; // Only 500ms gap

  // Hand G02-B
  state = createParsedState({
    handId: 'hand-G02-B',
    street: 'preflop',
    pot: SB_AMT + BB_AMT,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  rngSeed += 1;
  currentTime += 60000;


  // --- G04: Position Drift ---
  // BTN marker moves unexpectedly mid-hand
  // Hand G04
  // Frame 1: BTN at P0 (BTN role)
  state = createParsedState({
    handId: 'hand-G04',
    street: 'flop',
    pot: 10,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  rngSeed += 1;
  currentTime += 1000;

  // Frame 2: BTN moves to P1 (SB role) unexpectedly
  // Note: In createParsedState, positions.button is the role string. 
  // But usually it's derived from index. Here we simulate the *vision* reporting a different button location.
  // If we change positions.button to 'SB', it means the button is now at the seat that IS the SB.
  state = createParsedState({
    handId: 'hand-G04',
    street: 'flop',
    pot: 10,
    players: playersMap,
    positions: { hero: 'BTN', button: 'SB', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  rngSeed += 1;
  currentTime += 60000;


  // --- G05: Phantom Chips ---
  // Stack increases without pot decrease
  // Hand G05
  // Frame 1: Normal
  state = createParsedState({
    handId: 'hand-G05',
    street: 'flop',
    pot: 10,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  rngSeed += 1;
  currentTime += 1000;

  // Frame 2: BTN stack jumps +5, Pot same
  let playersMapPhantom = new Map(playersMap);
  playersMapPhantom.set('BTN', { stack: STARTING_STACK + 5 });

  state = createParsedState({
    handId: 'hand-G05',
    street: 'flop',
    pot: 10,
    players: playersMapPhantom,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  rngSeed += 1;
  currentTime += 60000;


  // --- G06: Pot Leak ---
  // Pot decreases mid-hand without showdown
  // Hand G06
  // Frame 1: Pot 20
  state = createParsedState({
    handId: 'hand-G06',
    street: 'turn',
    pot: 20,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  rngSeed += 1;
  currentTime += 1000;

  // Frame 2: Pot 15
  state = createParsedState({
    handId: 'hand-G06',
    street: 'turn',
    pot: 15,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  rngSeed += 1;
  currentTime += 60000;


  // --- G08: Stack Reload Mid-Session ---
  // Player reloads chips between hands
  // Hand G08-A: Ends with low stack
  let playersMapLow = new Map(playersMap);
  playersMapLow.set('BTN', { stack: 10 });
  state = createParsedState({
    handId: 'hand-G08-A',
    street: 'river',
    pot: 100,
    players: playersMapLow,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  rngSeed += 1;
  currentTime += 5000;

  // Hand G08-B: Starts with reloaded stack
  let playersMapReloaded = new Map(playersMap);
  playersMapReloaded.set('BTN', { stack: 100 });
  state = createParsedState({
    handId: 'hand-G08-B',
    street: 'preflop',
    pot: SB_AMT + BB_AMT,
    players: playersMapReloaded,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  rngSeed += 1;
  currentTime += 60000;


  // --- G10: Blind Posting Edge Case ---
  // SB posts with partial stack
  // Hand G10
  let playersMapPartial = new Map(playersMap);
  playersMapPartial.set('SB', { stack: 0.2 }); // Less than 0.5 SB

  // Frame 1: BB posted, SB short stack not yet posted
  state = createParsedState({
    handId: 'hand-G10',
    street: 'preflop',
    pot: BB_AMT,
    players: playersMapPartial,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  rngSeed += 1;
  currentTime += 500;

  // Frame 2: SB posts partial blind (all-in)
  playersMapPartial = new Map(playersMapPartial);
  playersMapPartial.set('SB', { stack: 0 });
  state = createParsedState({
    handId: 'hand-G10',
    street: 'preflop',
    pot: 0.2 + BB_AMT,
    players: playersMapPartial,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  rngSeed += 1;
  currentTime += 60000;


  // --- G11: Street Transition Under Pressure ---
  // Flop->Turn->River with timing constraints
  // Hand G11
  // Frame 1: Flop
  state = createParsedState({
    handId: 'hand-G11',
    street: 'flop',
    pot: 10,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  rngSeed += 1;
  currentTime += 100; // 100ms gap

  // Frame 2: Turn
  state = createParsedState({
    handId: 'hand-G11',
    street: 'turn',
    pot: 10,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  rngSeed += 1;
  currentTime += 100; // 100ms gap

  // Frame 3: River
  state = createParsedState({
    handId: 'hand-G11',
    street: 'river',
    pot: 10,
    players: playersMap,
    positions: { hero: 'BTN', button: 'BTN', smallBlind: 'SB', bigBlind: 'BB' },
    blinds: { small: SB_AMT, big: BB_AMT }
  });
  records.push(createRecord(state as unknown as GameState, currentTime, rngSeed));
  currentTime += 60000;

  const content = records.map(r => JSON.stringify(r)).join('\n');
  fs.writeFileSync(outputPath, content);
  console.log(`Generated ${records.length} records to ${outputPath}`);
}
