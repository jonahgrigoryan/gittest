Use this sequence after implementing Task 8. All paths are relative to repo root (/Users/jonahkesoyan/gittest-2).

0) Pre-flight checks (config and exports)
- Commands:
  ```bash
  # Verify betSizingSets are populated (not empty arrays)
  node -e "const cfg = require('./config/bot/default.bot.json'); const sets = cfg.strategy.betSizingSets; const empty = Object.values(sets).some(arr => !arr || arr.length === 0); console.log('✓ betSizingSets populated:', !empty); if(empty) { console.error('✗ ERROR: betSizingSets contain empty arrays'); process.exit(1); }"
  
  # Verify StrategyEngine is exported from index.ts
  grep -q "strategy/engine" packages/orchestrator/src/index.ts && echo "✓ StrategyEngine export found" || (echo "✗ ERROR: StrategyEngine not exported from index.ts" && exit 1)
  
  # Verify StrategyEngine is imported/used in main.ts (if integrated)
  grep -q "StrategyEngine\|strategy" packages/orchestrator/src/main.ts && echo "✓ StrategyEngine integration found in main.ts" || echo "⚠ WARNING: StrategyEngine may not be integrated in main.ts"
  ```
- What to check:
  - Config has populated betSizingSets arrays (not empty)
  - Strategy modules are exported from packages/orchestrator/src/index.ts
  - StrategyEngine is integrated into packages/orchestrator/src/main.ts

1) Type-check and lint
- Commands:
  ```bash
  pnpm install
  pnpm lint
  pnpm test --filter "@poker-bot/orchestrator" -- --runInBand --reporter=verbose 2>&1 | head -50
  ```
- What to check:
  - StrategyEngine-related files compile:
    - packages/orchestrator/src/strategy/types.ts
    - packages/orchestrator/src/strategy/blending.ts
    - packages/orchestrator/src/strategy/selection.ts
    - packages/orchestrator/src/strategy/sizing.ts
    - packages/orchestrator/src/strategy/divergence.ts
    - packages/orchestrator/src/strategy/risk.ts
    - packages/orchestrator/src/strategy/fallbacks.ts
    - packages/orchestrator/src/strategy/modeling.ts
    - packages/orchestrator/src/strategy/engine.ts
  - No unused imports / type errors around:
    - AggregatedAgentOutput imports from @poker-bot/agents
    - RiskController / safety types from packages/orchestrator/src/safety
  - StrategyEngine can be imported and instantiated without type errors

2) Unit tests for Strategy module
- Create/ensure these test files exist and cover Task 8:
  - packages/orchestrator/test/strategy/blending.spec.ts
  - packages/orchestrator/test/strategy/selection.spec.ts
  - packages/orchestrator/test/strategy/sizing.spec.ts
  - packages/orchestrator/test/strategy/divergence.spec.ts
  - packages/orchestrator/test/strategy/risk.spec.ts
  - packages/orchestrator/test/strategy/engine.spec.ts
- Commands:
  ```bash
  # Run all strategy unit tests
  pnpm test --filter "@poker-bot/orchestrator" -- --runInBand packages/orchestrator/test/strategy/
  
  # Run individual test suites for detailed output
  pnpm test --filter "@poker-bot/orchestrator" -- --runInBand packages/orchestrator/test/strategy/blending.spec.ts
  pnpm test --filter "@poker-bot/orchestrator" -- --runInBand packages/orchestrator/test/strategy/selection.spec.ts
  pnpm test --filter "@poker-bot/orchestrator" -- --runInBand packages/orchestrator/test/strategy/sizing.spec.ts
  pnpm test --filter "@poker-bot/orchestrator" -- --runInBand packages/orchestrator/test/strategy/divergence.spec.ts
  pnpm test --filter "@poker-bot/orchestrator" -- --runInBand packages/orchestrator/test/strategy/risk.spec.ts
  pnpm test --filter "@poker-bot/orchestrator" -- --runInBand packages/orchestrator/test/strategy/engine.spec.ts
  ```
- Expected:
  - Blending:
    - α bounds enforced [0.3, 0.9]; distributions normalized; correct mapping fold/check/call/raise → ActionKey.
    - Empty blend falls back to pure GTO (alpha=1.0).
  - Selection:
    - Same seed → same sampled action; empty/NaN → detected and escalated.
    - ActionKey decoding matches createActionKey format.
  - Sizing:
    - Quantization to configured betSizingSets; final amounts in state.legalActions.
    - Clamping respects minBet, maxBet, stack limits.
  - Divergence:
    - TV distance correct (0-100pp); logs when > divergenceThresholdPP.
    - Structured log entry includes top-3 actions from each distribution.
  - Risk:
    - Uses orchestrator RiskController; SafeAction comes from shared helper.
    - Risk violations trigger fallback with proper logging.
  - Engine:
    - Fallbacks:
      - GTO-only when agents fail/circuit-breaker.
      - SafeAction when risk blocks action.
      - Deadline preemption routes to GTO-only.
    - Deterministic with fixed seed.
    - Timing breakdown (gtoTime, agentTime, synthesisTime, totalTime) is accurate.

3) Integration tests for end-to-end decision
- Ensure:
  - packages/orchestrator/test/strategy/integration.spec.ts
- Commands:
  ```bash
  # Run integration tests
  pnpm test --filter "@poker-bot/orchestrator" -- --runInBand packages/orchestrator/test/strategy/integration.spec.ts
  
  # With verbose output
  pnpm test --filter "@poker-bot/orchestrator" -- --runInBand --reporter=verbose packages/orchestrator/test/strategy/integration.spec.ts
  ```
- Expected:
  - For synthetic GameState + GTOSolution + AggregatedAgentOutput:
    - StrategyEngine.decide() returns legal Action consistent with:
      - Fallback rules (GTO-only when agents fail, SafeAction when risk blocks),
      - α-blend (correct weighted combination),
      - betSizingSets (quantized to configured values),
      - Risk controller decisions (enforced with fallback).
    - StrategyDecision includes complete reasoning trace, timing, and metadata.
    - All fallback paths (GTO-only, SafeAction, deadline preemption) work correctly.

4) Performance / SLA checks
- Ensure:
  - packages/orchestrator/test/strategy/performance.spec.ts
- Commands:
  ```bash
  # Run performance tests
  pnpm test --filter "@poker-bot/orchestrator" -- --runInBand packages/orchestrator/test/strategy/performance.spec.ts
  
  # With timing output
  pnpm test --filter "@poker-bot/orchestrator" -- --runInBand --reporter=verbose packages/orchestrator/test/strategy/performance.spec.ts
  ```
- Expected:
  - Simulated decision loop (blend + select + size + risk) runs < 2s P95 (in practice should be orders of magnitude lower, typically < 50ms).
  - No pathological slow paths when agents are missing or fallbacks trigger.
  - Memory usage remains bounded across multiple decisions.
  - Deadline preemption triggers correctly when < 100ms remaining.

5) Cross-package sanity
- Commands:
  ```bash
  # Test agents package compatibility
  pnpm test --filter "@poker-bot/agents"
  
  # Verify AggregatedAgentOutput type compatibility
  node -e "const { AggregatedAgentOutput } = require('@poker-bot/agents'); console.log('✓ AggregatedAgentOutput type available');"
  
  # Orchestrator smoke test (basic runtime check)
  pnpm test --filter "@poker-bot/orchestrator" -- --runInBand packages/orchestrator/test/smoke.spec.ts
  
  # Verify StrategyEngine can be imported from built package
  pnpm --filter "@poker-bot/orchestrator" run build
  node -e "try { const { StrategyEngine } = require('./packages/orchestrator/dist/index.js'); console.log('✓ StrategyEngine exported from dist:', !!StrategyEngine); } catch(e) { console.error('✗ StrategyEngine not exported:', e.message); process.exit(1); }"
  ```
- Expected:
  - Agents package tests pass (AggregatedAgentOutput schema matches StrategyEngine expectations).
  - Orchestrator smoke test passes (run() executes without errors).
  - StrategyEngine is exported from built package and can be imported.

6) StrategyEngine integration verification
- Commands:
  ```bash
  # Verify StrategyEngine is actually used in main.ts decision flow
  grep -A 5 "StrategyEngine\|strategyEngine" packages/orchestrator/src/main.ts || echo "⚠ WARNING: StrategyEngine may not be integrated"
  
  # Verify makeDecision() returns StrategyDecision (if integrated)
  grep -q "StrategyDecision" packages/orchestrator/src/main.ts && echo "✓ StrategyDecision return type found" || echo "⚠ WARNING: makeDecision may still return GTOSolution"
  
  # Check that agent coordinator is wired (or mocked)
  grep -q "AgentCoordinator\|agentCoordinator\|agents\.query" packages/orchestrator/src/main.ts && echo "✓ Agent coordinator integration found" || echo "⚠ WARNING: Agent coordinator may not be integrated"
  
  # Verify config hot-reload subscription for strategy
  grep -A 3 "subscribe.*strategy\|strategy.*subscribe" packages/orchestrator/src/main.ts && echo "✓ Strategy config hot-reload found" || echo "⚠ INFO: Strategy config hot-reload may be optional"
  ```
- Expected:
  - StrategyEngine is instantiated in run() with proper dependencies.
  - makeDecision() (or equivalent) calls strategyEngine.decide().
  - Agent coordinator is integrated or mocked for testing.
  - Config hot-reload subscription exists for strategy changes (optional but recommended).

7) CI-style root check
- Commands:
  ```bash
  # Environment verification
  pnpm run verify:env
  
  # Full test suite
  pnpm test
  
  # Build all packages to catch any build-time errors
  pnpm build
  
  # Type-check orchestrator package specifically
  pnpm --filter "@poker-bot/orchestrator" run build
  ```
- Expected:
  - All suites green.
  - No TypeScript or Jest/Vitest errors arising from Task 8 files.
  - All packages build successfully.
  - No runtime import errors when StrategyEngine is used.

8) Manual verification checklist
- After all automated tests pass, manually verify:
  ```bash
  # 1. Config has valid betSizingSets
  cat config/bot/default.bot.json | grep -A 5 "betSizingSets"
  
  # 2. All strategy modules are exported
  grep "strategy" packages/orchestrator/src/index.ts
  
  # 3. StrategyEngine can be instantiated (if main.ts integration complete)
  # This would require running the actual orchestrator with proper mocks
  ```
- Expected:
  - Config shows populated betSizingSets arrays.
  - index.ts exports all strategy modules.
  - StrategyEngine can be instantiated with valid config and dependencies.

---

**Summary**: If all commands above pass and Strategy-specific tests behave as specified in task8.md, your Task 8 implementation is validated. Pay special attention to:
- Config validation (step 0)
- Integration verification (step 6)
- Full test coverage (steps 2-4)
- Cross-package compatibility (step 5)
