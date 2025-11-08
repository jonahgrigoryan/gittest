# Task 8: Implement Strategy Engine

**Goal**: Implement the Strategy Engine that blends GTO solutions with multi-agent LLM recommendations, selects final actions with proper bet sizing, detects divergences, integrates risk checks, and produces deterministic decisions within the 2-second budget.

**Architecture**: TypeScript module in orchestrator package that receives GTOSolution and AggregatedAgentOutput, applies α-blending formula, selects actions via seeded RNG, quantizes bet sizes, checks risk limits, and returns StrategyDecision with full reasoning trace.

---

## Prerequisites

- Task 1‑7 complete (RiskGuard + persistence already wired in orchestrator main)
- GTO Solver returns `GTOSolution` with action probabilities keyed by `ActionKey`
- Agent Coordinator returns `AggregatedAgentOutput` with `normalizedActions: Map<ActionType, number>` (ActionType ∈ {"fold","check","call","raise"})
- Time Budget Tracker enforces 2‑second deadline
- `risk` controller from Task 7 (startHand/incrementHandCount/enforceAction/recordOutcome/snapshot) is exposed to downstream modules
- Configuration Manager provides `strategy.*` settings with hot reload
- **packages/orchestrator/package.json** declares the agents workspace dependency:
  ```jsonc
  "dependencies": {
    "@grpc/grpc-js": "1.11.1",
    "@poker-bot/shared": "workspace:*",
    "@poker-bot/agents": "workspace:*"
  }
  ```
- **packages/orchestrator/tsconfig.json** maps the agents package so TypeScript resolves it:
  ```jsonc
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "composite": true,
      "declaration": true,
      "rootDir": "src",
      "outDir": "dist",
      "paths": {
        "@poker-bot/agents": ["../agents/src"]
      }
    },
    "include": ["src/**/*"]
  }
  ```

---

## 8.1 Create Blending Algorithm

### 8.1.1 Define Strategy Engine Interface

**File**: `packages/orchestrator/src/strategy/types.ts`

```typescript
import type { Action, ActionKey, GameState } from "@poker-bot/shared";
import type { GTOSolution } from "@poker-bot/shared";
import type { AggregatedAgentOutput } from "@poker-bot/agents";
import type { RiskController } from "../safety/types"; // risk controller exposed by orchestrator runtime

export interface StrategyConfig {
  alphaGTO: number;  // [0.3, 0.9] - GTO weight in blend
  betSizingSets: {
    preflop: number[];
    flop: number[];
    turn: number[];
    river: number[];
  };
  divergenceThresholdPP: number;  // Log when GTO vs agents differ >30pp
  rngSeed?: number;  // For deterministic replay
}

export interface BlendedDistribution {
  actions: Map<ActionKey, number>;
  alpha: number;
  gtoWeight: number;
  agentWeight: number;
}

export interface StrategyDecision {
  action: Action;
  reasoning: {
    gtoRecommendation: Map<ActionKey, number>;
    agentRecommendation: Map<ActionKey, number>;
    blendedDistribution: Map<ActionKey, number>;
    alpha: number;
    divergence: number;
    riskCheckPassed: boolean;
    sizingQuantized: boolean;
  };
  timing: {
    gtoTime: number;
    agentTime: number;
    synthesisTime: number;
    totalTime: number;
  };
  metadata: {
    rngSeed: number;
    configSnapshot: StrategyConfig;
    riskSnapshot?: any;  // From risk controller
  };
}
```

### 8.1.2 Implement Blending Formula

**File**: `packages/orchestrator/src/strategy/blending.ts`

Implement class `StrategyBlender`:
- `constructor(config: StrategyConfig)`

- `blend(gtoSolution: GTOSolution, agentOutput: AggregatedAgentOutput): BlendedDistribution`
  - Extract action probabilities from GTOSolution.actions Map (ActionKey → ActionSolution)
  - Use agentOutput.normalizedActions Map (ActionType → number)
  - **Map ActionType to ActionKey**: For each ActionType in agent output, find matching ActionKeys in GTO solution
  - Apply formula: `blended[actionKey] = α × gto[actionKey] + (1-α) × agent[actionType]` (distributed across matching keys)
  - Handle missing actions (default to 0 probability)
  - Return BlendedDistribution with alpha, weights, and normalized probabilities

- `validateAlpha(alpha: number): boolean`
  - Ensure α ∈ [0.3, 0.9] per requirements
  - Return true if valid

- `computeWeights(alpha: number): { gto: number; agent: number }`
  - Return { gto: alpha, agent: 1 - alpha }

**Key Logic**:
- **Action Distribution Mapping**: Agent output provides ActionType-level probabilities (fold, check, call, raise). GTO provides ActionKey-level probabilities (specific amounts). For each ActionType, distribute agent probability across all matching ActionKeys proportionally to their GTO probabilities.
- Actions present in GTO but not agents get full GTO weight
- Actions present in agents but not GTO get (1-α) weight distributed across matching keys
- Common actions use blended formula
- Probabilities renormalized to sum to 1.0

### 8.1.3 Add Runtime Alpha Adjustment

**File**: `packages/orchestrator/src/strategy/blending.ts` (extend)

Add to `StrategyBlender`:
- `setAlpha(alpha: number): boolean`
  - Validate alpha bounds
  - Update internal alpha
  - Return success flag

- `getCurrentAlpha(): number`
  - Return current alpha value

**Integration**:
- Subscribe to config changes via ConfigurationManager
- Update alpha when "strategy.alphaGTO" changes
- Log alpha changes for debugging

---

## 8.2 Implement Action Selection and Bet Sizing

### 8.2.1 Create Action Selector with Seeded RNG

**File**: `packages/orchestrator/src/strategy/selection.ts`

Implement class `ActionSelector`:
- `constructor(rngSeed?: number)`

- `selectAction(distribution: Map<ActionKey, number>, rng?: RNG): ActionKey`
  - Sample from probability distribution using seeded RNG
  - Return winning ActionKey
  - Handle edge cases (empty distribution, NaN probabilities)

- `createRNG(seed?: number): RNG`
  - Use deterministic seed: `seed || hash(handId + sessionId)`
  - Return RNG interface implementation

**RNG Implementation**:
```typescript
class SeededRNG implements RNG {
  private seed: number;
  constructor(seed: number) {
    this.seed = seed;
  }
  next(): number {
    // Simple LCG implementation for determinism
    this.seed = (this.seed * 1664525 + 1013904223) % 2**32;
    return this.seed / 2**32;
  }
}
```

**ActionKey Selection Logic**:
- Convert ActionKey-level distribution to cumulative probabilities
- Sample random value [0,1) using seeded RNG
- Find first ActionKey where cumulative probability exceeds sample
- Return selected ActionKey

### 8.2.2 Implement Bet Sizing Quantization

**File**: `packages/orchestrator/src/strategy/sizing.ts`

Implement class `BetSizer`:
- `constructor(config: StrategyConfig)`

- `quantizeBetSize(action: Action, state: GameState): Action`
  - If action.type is not 'raise', return unchanged
  - Get street-specific sizing set from config
  - Find closest pot fraction in set
  - Convert to absolute chips: `amount = fraction * (pot + betToCall)`
  - Clamp to table limits and stack sizes
  - Return updated Action

- `findNearestFraction(targetFraction: number, availableFractions: number[]): number`
  - Find closest value in sorted array
  - Use binary search for efficiency
  - Return exact match or nearest neighbor

- `clampToLimits(amount: number, minBet: number, maxBet: number, stack: number): number`
  - Ensure amount ≥ minBet
  - Ensure amount ≤ maxBet
  - Ensure amount ≤ stack
  - Return clamped value

**Bet Sizing Logic**:
- Agent sizing is pot fraction (0.5 = half pot)
- Quantize to nearest discrete size from config set
- Enforce site minimum increment rules
- Prevent over-betting stack
- Assert final amount is valid before returning

### 8.2.3 Integrate Action Selection Pipeline

**File**: `packages/orchestrator/src/strategy/selection.ts` (extend)

Add to `ActionSelector`:
- `selectAndSizeAction(actionKey: ActionKey, distribution: Map<ActionKey, number>, state: GameState, betSizer: BetSizer): Action`
  - Parse ActionKey back to Action object
  - Apply bet sizing quantization
  - Return complete Action with amount if raise

- `parseActionKey(actionKey: ActionKey): Action`
  - Reverse of createActionKey function
  - Extract street, position, type, amount
  - Return Action object

---

## 8.3 Add Divergence Detection and Logging

### 8.3.1 Implement Divergence Calculator

**File**: `packages/orchestrator/src/strategy/divergence.ts`

Implement class `DivergenceDetector`:
- `constructor(thresholdPP: number)`

- `computeDivergence(dist1: Map<ActionKey, number>, dist2: Map<ActionKey, number>): number`
  - Calculate total variation distance: `Σ|dist1[action] - dist2[action]| / 2`
  - Return divergence in percentage points (0-100)

- `shouldLogDivergence(divergence: number): boolean`
  - Return divergence > thresholdPP

- `formatDivergenceLog(gto: Map<ActionKey, number>, agent: Map<ActionKey, number>, divergence: number): object`
  - Create structured log entry
  - Include top 3 actions from each distribution
  - Include divergence value and threshold

**Divergence Types**:
- GTO vs Agent recommendations
- Individual agent vs consensus
- Historical vs current recommendations

### 8.3.2 Add Divergence Logging Integration

**File**: `packages/orchestrator/src/strategy/engine.ts` (extend)

Add to `StrategyEngine`:
- `logDivergenceIfNeeded(gtoDist: Map<ActionKey, number>, agentDist: Map<ActionKey, number>, state: GameState): void`
  - Compute divergence
  - If above threshold, log full trace
  - Include state, RNG seeds, model hashes

**Log Structure**:
```typescript
{
  type: "strategy_divergence",
  handId: string,
  divergence: number,
  threshold: number,
  gtoTopActions: Array<{action: ActionKey, prob: number}>,
  agentTopActions: Array<{action: ActionKey, prob: number}>,
  alpha: number,
  rngSeed: number,
  modelHashes: Record<string, string>
}
```

---

## 8.4 Integrate Risk Checks and Fallbacks

### 8.4.1 Use Orchestrator Risk Controller

**File**: `packages/orchestrator/src/strategy/risk.ts`

Implement a thin wrapper over the Task 7 risk controller:

- `constructor(riskController: { enforceAction: (action: Action, state: GameState, fallback: () => Action, options?: RiskCheckOptions) => { action: Action; result: RiskCheckResult }; snapshot: () => RiskSnapshot })`
- `enforceWithFallback(action: Action, state: GameState, safeActionFactory: () => Action, options?: RiskCheckOptions): { action: Action; result: RiskCheckResult }`
  - Delegates to `riskController.enforceAction`
  - Logs violations (reason, snapshot) when `result.allowed === false`
- `getSafeAction(state: GameState): Action`
  - Calls existing `selectSafeAction(state)` helper; no duplicate SafeAction logic
- `getSnapshot(): RiskSnapshot`
  - Returns `riskController.snapshot()` for inclusion in `StrategyDecision.metadata`

**Risk Integration Points**:
- After bet sizing (and before returning the decision), call `riskIntegration.enforceWithFallback(action, state, () => selectSafeAction(state))`
- If the returned `result.allowed` is false, use the fallback action from the enforcement result and surface the violation metadata inside `StrategyDecision.reasoning`/`metadata`
- Strategy Engine never instantiates `RiskGuard`; orchestrator `run()` already handles lifecycle: `risk.startHand`, `risk.incrementHandCount`, `risk.recordOutcome`, configuration hot reload, and persistence.

### 8.4.2 Implement GTO-Only Fallback

**File**: `packages/orchestrator/src/strategy/fallbacks.ts`

Implement class `FallbackHandler`:
- `constructor()`

- `shouldUseGTOOnly(agentOutput: AggregatedAgentOutput): boolean`
  - Return true if agentOutput.outputs.length === 0
  - Return true if agentOutput.circuitBreakerTripped
  - Return true if all agents timed out

- `createGTOOnlyDecision(gtoSolution: GTOSolution, state: GameState, selector: ActionSelector, betSizer: BetSizer): StrategyDecision`
  - Set alpha = 1.0 (pure GTO)
  - Select action from GTO distribution
  - Apply bet sizing
  - Return decision with GTO-only reasoning

**Fallback Triggers**:
- All agents timeout or fail validation
- Circuit breaker tripped
- Agent coordinator returns empty outputs
- Manual override via config

### 8.4.3 Add Panic Stop Telemetry

- Whenever `riskIntegration.enforceWithFallback` reports `panicStop` in its snapshot, emit structured logs/metrics so SafeMode (Task 11) can respond.
- Strategy Engine simply surfaces the panic metadata; executor halting is handled by downstream tasks.

---

## 8.5 Create StrategyDecision Output

### 8.5.1 Implement Main Strategy Engine

**File**: `packages/orchestrator/src/strategy/engine.ts`

Implement class `StrategyEngine`:
- `constructor(config: StrategyConfig, riskController: RiskController, timeBudgetTracker?: TimeBudgetTracker)`

- `decide(state: GameState, gtoSolution: GTOSolution, agentOutput: AggregatedAgentOutput): StrategyDecision`
  - Start timing measurement
  - Check if GTO-only fallback needed
  - Blend distributions using StrategyBlender
  - Detect and log divergences
  - Select action using ActionSelector
  - Apply bet sizing using BetSizer
  - Check risk limits using RiskChecker
  - Override with SafeAction if risk check fails
  - Return complete StrategyDecision

**Decision Flow**:
1. Check fallback conditions → use GTO-only if needed
2. Blend GTO + agent distributions
3. Log divergence if > threshold
4. Sample action from blended distribution
5. Quantize bet size to discrete set
6. Check risk limits
7. Return SafeAction if risk violated
8. Return final decision with full trace

### 8.5.2 Add Timing and Metadata Tracking

**File**: `packages/orchestrator/src/strategy/engine.ts` (extend)

Add to `StrategyEngine`:
- `trackTiming(startTime: number, gtoTime: number, agentTime: number): StrategyDecision['timing']`
  - Calculate synthesis time
  - Return timing breakdown

- `collectMetadata(state: GameState, config: StrategyConfig, rngSeed: number): StrategyDecision['metadata']`
  - Include RNG seed for replay
  - Snapshot current config
  - Include risk guard state
  - Return metadata object

**Performance Tracking**:
- Per-component timing (GTO, agents, synthesis)
- Total decision time
- Memory usage if available
- Cache hit rates

### 8.5.3 Ensure 2-Second Deadline Compliance

**File**: `packages/orchestrator/src/strategy/engine.ts` (extend)

Add to `StrategyEngine`:
- `enforceDeadline(): void`
  - Check remaining time via TimeBudgetTracker
  - Preempt if <100ms remaining
  - Return GTO-only decision if preempted

**Deadline Enforcement**:
- Query shouldPreempt() before expensive operations
- Graceful degradation to GTO-only
- Log preemption events
- Target P95 < 2 seconds

---

## 8.6 Add Opponent Modeling Statistics Store (Optional)

### 8.6.1 Implement Statistics Collector

**File**: `packages/orchestrator/src/strategy/modeling.ts`

Implement class `OpponentModeler`:
- `constructor()`

- `recordAction(position: Position, action: Action, street: Street): void`
  - Update frequency statistics for position
  - Track VPIP, PFR, 3-bet, fold frequencies

- `getPositionStats(position: Position): PositionStats`
  - Return aggregated statistics
  - Include confidence intervals

**Statistics Tracked**:
- VPIP (Voluntarily Put In Pot)
- PFR (Pre-Flop Raise)
- 3-bet frequency
- Fold to continuation bet
- Check-raise frequency

### 8.6.2 Integrate Modeling into Strategy

**File**: `packages/orchestrator/src/strategy/engine.ts` (extend)

Add to `StrategyEngine`:
- `incorporateOpponentModeling(distribution: Map<ActionKey, number>, opponentStats: PositionStats): Map<ActionKey, number>`
  - Adjust probabilities based on opponent tendencies
  - Boost exploitation lines
  - Return adjusted distribution

**Modeling Integration**:
- Optional feature (disabled by default)
- Requires sufficient sample size (>100 hands)
- Log modeling adjustments
- Fallback to base strategy if no data

---

## Testing and Validation

### Unit Tests

**File**: `packages/orchestrator/test/strategy/blending.spec.ts`
- Test blending formula with known distributions
- Test alpha validation and bounds
- Test missing action handling

**File**: `packages/orchestrator/test/strategy/selection.spec.ts`
- Test action selection with seeded RNG
- Test deterministic replay with same seed
- Test edge cases (empty distribution)

**File**: `packages/orchestrator/test/strategy/sizing.spec.ts`
- Test bet size quantization to discrete sets
- Test clamping to limits and stacks
- Test per-street sizing sets

**File**: `packages/orchestrator/test/strategy/divergence.spec.ts`
- Test divergence calculation
- Test logging thresholds
- Test formatted log output

**File**: `packages/orchestrator/test/strategy/risk.spec.ts`
- Test risk limit checking
- Test SafeAction selection
- Test panic stop handling

**File**: `packages/orchestrator/test/strategy/engine.spec.ts`
- Test full decision pipeline
- Test timing tracking
- Test metadata collection

### Integration Tests

**File**: `packages/orchestrator/test/strategy/integration.spec.ts`
- End-to-end decision flow with mock inputs
- Test GTO-only fallback
- Test risk override behavior
- Test deadline enforcement

### Performance Tests

**File**: `packages/orchestrator/test/strategy/performance.spec.ts`
- Benchmark decision time P50/P95/P99
- Test memory usage
- Verify 2-second deadline compliance

---

## Wire Strategy Engine into Orchestrator

### Update Main Pipeline

**File**: `packages/orchestrator/src/main.ts` (extend)

Add to main decision loop:
- Initialize StrategyEngine with config and the orchestrator-provided risk controller
- After getting GTO and agent results:
  - Call `strategyEngine.decide(state, gtoSolution, agentOutput)`
  - Check if SafeAction triggered
  - Execute decision or SafeAction
  - Log StrategyDecision

### Configuration Integration

**File**: `config/bot/default.bot.json` (extend)

Add strategy section:
```json
{
  "strategy": {
    "alphaGTO": 0.6,
    "betSizingSets": {
      "preflop": [0.5, 1.0, 2.0, 3.0],
      "flop": [0.33, 0.5, 0.75, 1.0],
      "turn": [0.5, 0.75, 1.0, 1.5],
      "river": [0.5, 1.0, 1.5, 2.0]
    },
    "divergenceThresholdPP": 30
  }
}
```

---

## Success Criteria

Task 8 is complete when:
1. Strategy Engine blends GTO and agent recommendations using α parameter
2. Action selection uses seeded RNG for deterministic replay
3. Bet sizing quantizes to discrete sets with proper clamping
4. Divergence detection logs when GTO vs agents differ >30pp
5. Risk checks override with SafeAction when limits exceeded
6. GTO-only fallback works when agents fail
7. Full decision pipeline completes within 2 seconds at P95
8. All unit and integration tests pass
9. No TypeScript compilation errors
10. Documentation is complete

---

## Notes

- Start with α=0.6 (balanced GTO vs exploitation)
- Use seeded RNG for reproducible testing
- SafeAction policy prioritizes safety over profit
- Risk checks happen after action selection but before execution
- Divergence logging helps tune α parameter
- Bet sizing sets are configurable per game type
- Opponent modeling is optional advanced feature
- All timing measurements use high-resolution timers
- Configuration hot-reload updates strategy parameters
- Strategy Engine is single-threaded (no concurrency needed)
