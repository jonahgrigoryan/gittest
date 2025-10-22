# Implementation Plan

- [ ] 1. Set up project structure and core interfaces
  - Create directory structure for vision, solver, agents, strategy, executor, logger, and shared modules
  - Define TypeScript interfaces for core types: Card, Action, Position, Street, GameState, RNG
  - Implement configuration schema and validation using JSON Schema
  - Set up build system with pinned dependencies for reproducible builds
  - Set up Rust/C++/Python solver service with gRPC interface (TypeScript as orchestrator only)
  - _Requirements: 0.1, 10.2_

- [ ] 2. Implement Configuration Manager
  - [ ] 2.1 Create configuration loading and validation
    - Implement BotConfig interface with all required sections
    - Write JSON Schema validator for configuration structure
    - Implement file loading with error handling
    - _Requirements: 8.1, 8.6_
  
  - [ ] 2.2 Implement hot-reload with rollback
    - Add file watcher for configuration changes
    - Implement validation-before-apply logic
    - Create rollback mechanism to restore last-known-good config
    - _Requirements: 8.2, 8.6_
  
  - [ ] 2.3 Add configuration subscription system
    - Implement pub-sub pattern for config change notifications
    - Create getter methods with key path support
    - _Requirements: 8.2_
  
  - [ ] 2.4 Write unit tests for Config schema validator
    - Test validation with valid and invalid configurations
    - Test rollback on validation failure
    - Test hot-reload behavior
    - _Requirements: 8.6_

- [ ] 3. Implement Vision System and Game State Parser with model preloading
  - [ ] 3.1 Create layout pack system
    - Define LayoutPack JSON schema with ROI definitions and version field
    - Implement layout pack loader with version validation
    - Add DPI and theme calibration routine
    - Create sample layout packs for common poker platforms
    - _Requirements: 1.5_
  
  - [ ] 3.2 Implement frame capture and element extraction
    - Integrate screen capture library
    - Implement ROI-based extraction for cards, stacks, pot, buttons
    - Add ONNX-Runtime CNN models for card rank/suit and stack digit recognition
    - Preload ONNX models and warm sessions on startup to avoid first-hand latency spikes
    - Keep template matching and OCR as fallback for unsupported themes
    - _Requirements: 1.1, 1.3_
  
  - [ ] 3.3 Add confidence scoring and occlusion detection
    - Implement per-element confidence calculation based on match quality
    - Add occlusion detection by analyzing ROI pixel variance
    - Create VisionOutput interface with confidence and latency tracking
    - _Requirements: 1.2, 1.6, 1.7, 1.9_
  
  - [ ] 3.4 Implement Game State Parser
    - Convert VisionOutput to structured GameState JSON
    - Implement position assignment logic (BTN/SB/BB inference)
    - Add state-sync error tracking across consecutive frames
    - Compute legal actions based on game rules
    - _Requirements: 1.4, 1.8_
  
  - [ ] 3.5 Add confidence gating and SafeAction trigger
    - Implement shouldTriggerSafeAction logic (confidence <0.995 or occlusion >5%)
    - Create SafeAction policy: preflop check-or-fold, postflop check-or-fold
    - Honor forced actions (blinds auto-posted, all-in only when committed)
    - _Requirements: 1.2, 10.3, 10.6_
  
  - [ ] 3.7 Write unit tests for SafeAction policy
    - Test SafeAction selection for various game states
    - Test forced action handling (blinds, all-in commitments)
    - Test confidence gating triggers
    - _Requirements: 10.6_
  
  - [ ] 3.6 Create vision golden test suite
    - Build fixed image set covering various game states
    - Write tests for per-element confidence scoring
    - Test occlusion gating and state-sync checks
    - _Requirements: 1.2, 1.6, 1.7, 1.8, 1.9_

- [ ] 4. Implement GTO Solver
  - [ ] 4.1 Create cache system for precomputed solutions
    - Define state fingerprinting algorithm with fields: street, positions, stacks bucketed, pot, blinds, board cards, action history discretized, SPR, version byte
    - Implement cache storage format (compressed binary)
    - Create cache loader and query interface
    - Build sample cache for common preflop and flop situations
    - Preload preflop and flop caches on startup to avoid first-hand latency spikes
    - _Requirements: 2.1, 2.6_
  
  - [ ] 4.2 Implement subgame solver
    - Integrate CFR algorithm library or implement basic CFR
    - Add game tree abstraction (card bucketing, action abstraction)
    - Implement budget-aware solving with early stopping
    - _Requirements: 2.2_
  
  - [ ] 4.3 Add deep-stack adjustments
    - Implement effective stack calculation
    - Create deep-stack action abstractions (more bet sizes)
    - Apply adjustments when effective stack >100bb
    - _Requirements: 2.4_
  
  - [ ] 4.4 Create GTOSolution output interface
    - Return action frequencies, EVs, and regret deltas
    - Track computation time and source (cache vs subgame)
    - Return cached policy when budget would be exceeded
    - _Requirements: 2.5, 2.6_

- [ ] 5. Implement Agent Coordinator and LLM integration
  - [ ] 5.1 Create LLM agent interface and prompt system
    - Define AgentOutput interface with reasoning, recommendation, sizing, confidence
    - Implement prompt template system with persona injection
    - Create sample personas (GTO purist, exploitative aggressor, risk-averse)
    - _Requirements: 3.1_
  
  - [ ] 5.2 Implement parallel agent querying
    - Set up concurrent API calls to multiple LLM providers
    - Add timeout handling (3s per agent)
    - Implement retry logic for transient failures
    - _Requirements: 3.2_
  
  - [ ] 5.3 Add JSON schema validation
    - Define strict output schema for agent responses
    - Implement schema validator
    - Discard malformed outputs and count toward timeout
    - _Requirements: 3.7_
  
  - [ ] 5.4 Implement agent weighting and aggregation
    - Create weighted voting system based on confidence scores
    - Implement Brier score tracking per agent
    - Add calibration method using labeled validation set
    - Generate AggregatedAgentOutput with consensus metric
    - _Requirements: 3.4, 3.5_
  
  - [ ] 5.5 Add cost controls and circuit breaker for LLM agents
    - Implement per-decision token and time caps
    - Drop or degrade agents under budget pressure
    - Track token usage and cost per hand
    - Add circuit breaker: trip after N consecutive timeouts/errors, force α=1.0 for M hands
    - _Requirements: 4.6_
  
  - [ ] 5.6 Write unit tests for agent JSON schema validator
    - Test schema validation with valid and malformed JSON
    - Test timeout counting for malformed outputs
    - Test circuit breaker triggering
    - _Requirements: 3.7_

- [ ] 6. Implement Time Budget Tracker
  - [ ] 6.1 Create budget allocation and tracking
    - Define BudgetAllocation interface with per-component budgets
    - Implement high-resolution timer (performance.now())
    - Create budget tracking with elapsed/remaining methods
    - _Requirements: 4.6_
  
  - [ ] 6.2 Add preemption logic
    - Implement shouldPreempt() checks for each component
    - Add dynamic budget adjustment when perception overruns
    - Track actual durations for P50/P95/P99 analysis
    - _Requirements: 4.1, 4.6_
  
  - [ ] 6.3 Write unit tests for Time Budget Tracker
    - Test budget allocation and tracking
    - Test preemption logic under various timing scenarios
    - Test dynamic budget adjustment
    - _Requirements: 4.6_

- [ ] 7. Implement Risk Guard
  - [ ] 7.1 Create risk limit enforcement
    - Implement RiskGuard class with bankroll and session tracking
    - Add checkLimits() method called before action finalization
    - Trigger panic stop when limits exceeded
    - _Requirements: 10.4_
  
  - [ ] 7.2 Write unit tests for RiskGuard
    - Test bankroll tracking and limit enforcement
    - Test session limit enforcement
    - Test panic stop triggering
    - _Requirements: 10.4_

- [ ] 8. Implement Strategy Engine
  - [ ] 8.1 Create blending algorithm
    - Implement blend() method: α × GTO + (1-α) × Exploit
    - Add runtime α adjustment within bounds [0.3, 0.9]
    - _Requirements: 4.2_
  
  - [ ] 8.2 Implement action selection and bet sizing
    - Create selectAction() using seeded RNG to sample from distribution
    - Implement quantizeBetSize() to map continuous sizing to discrete set
    - Support per-street bet sizing sets from config
    - Enforce bet size legality: clamp to site min increment and table caps
    - Assert bet size validity before passing to executor
    - _Requirements: 4.7_
  
  - [ ] 8.3 Add divergence detection and logging
    - Implement computeDivergence() using total variation distance
    - Log full trace when divergence >30pp (state, seeds, model hashes)
    - _Requirements: 4.3_
  
  - [ ] 8.4 Integrate risk checks and fallbacks
    - Call RiskGuard.checkLimits() before finalizing decision
    - Implement GTO-only fallback when agents timeout (α=1.0)
    - Return SafeAction when risk limits exceeded
    - _Requirements: 4.5, 10.3_
  
  - [ ] 8.6 Add opponent modeling statistics store (optional)
    - Create per-villain frequency tracking (VPIP, PFR, 3bet, etc.)
    - Store node-level action weights
    - Feed statistics to Strategy Engine and agent prompts for exploitation
    - _Requirements: 4.2_
  
  - [ ] 8.5 Create StrategyDecision output
    - Package final action with reasoning breakdown
    - Include timing for GTO, agents, and synthesis
    - Ensure end-to-end decision within 2s at P95
    - _Requirements: 4.1_

- [ ] 9. Implement Action Executor
  - [ ] 9.1 Create simulator/API executor
    - Implement executeSimulator() for direct API calls
    - Implement executeAPI() for REST/WebSocket interfaces
    - Add action translation logic (decision → interface commands)
    - _Requirements: 5.1_
  
  - [ ] 9.2 Add research UI mode with compliance checks
    - Gate research UI behind build flag --research-ui (default off)
    - Implement executeResearchUI() using OS-level automation
    - Add environment validation against allowlist
    - Enforce compliance: refuse execution on prohibited sites
    - _Requirements: 5.2, 5.3, 0.2, 0.3, 0.4_
  
  - [ ] 9.3 Implement action verification
    - Capture post-action frame and parse state
    - Define strict equality rules for expected state comparison
    - Re-evaluate once on mismatch with bounded retry, then halt
    - _Requirements: 5.4, 5.5_
  
  - [ ] 9.4 Add bet sizing precision
    - Support fold, check, call, raise with exact amounts
    - Implement bet sizing from discrete set
    - _Requirements: 5.6_

  - [ ] 9.5 Implement Window Manager
    - Create window detection using OS APIs (Windows: EnumWindows, Linux: xdotool)
    - Add window validation against process names and titles
    - Implement coordinate conversion from ROI to screen space
    - _Requirements: 5.7.1, 5.7.2, 5.7.5_

  - [ ] 9.6 Extend Vision System for action buttons
    - Add template matching for action buttons (fold/check/call/raise)
    - Implement turn state detection (timer, active player indicators)
    - Update VisionOutput interface with button locations
    - _Requirements: 5.7.3, 5.7.4_

  - [ ] 9.7 Enhance research UI executor
    - Implement window focus management
    - Add turn waiting logic with timeout
    - Create cross-platform mouse/keyboard automation
    - Handle bet sizing input fields
    - _Requirements: 5.7.6, 5.7.7_

- [ ] 10. Implement Hand History Logger
  - [ ] 10.1 Create logging data structures
    - Define HandRecord interface with all required fields
    - Include raw state, parsed state, solver output, agent texts, decision, timings
    - Add metadata: RNG seeds, model hashes, config snapshot
    - _Requirements: 6.1, 6.3_
  
  - [ ] 10.2 Implement log persistence
    - Create append-only log files (one per session)
    - Persist hand records within 1s of hand completion
    - _Requirements: 6.2_
  
  - [ ] 10.3 Add PII redaction
    - Implement redactPII() to remove player names, IDs, IP addresses
    - Replace with position labels
    - _Requirements: 6.5_
  
  - [ ] 10.4 Implement export formats
    - Create JSON exporter (pretty-printed)
    - Create ACPC format exporter
    - _Requirements: 6.4_
  
  - [ ] 10.5 Add metrics tracking
    - Track win rate (bb/100), EV accuracy, decision quality
    - Compute P50/P95/P99 latency distributions per module
    - Generate SessionMetrics summaries
    - _Requirements: 6.7, 6.8_
  
  - [ ] 10.6 Implement retention policy
    - Add configurable retention window
    - Auto-delete logs older than retention period
    - _Requirements: 6.6_

- [ ] 11. Implement Health Monitor
  - [ ] 11.1 Create health check system
    - Implement checkComponent() for each major component
    - Add periodic health checks every 5-10 seconds
    - Return HealthStatus with status and message
    - _Requirements: 7.3_
  
  - [ ] 11.2 Implement safe mode
    - Create enterSafeMode() to lock Action Executor
    - Continue logging in safe mode
    - Add exitSafeMode() for manual recovery
    - _Requirements: 7.2_
  
  - [ ] 11.3 Add panic stop logic
    - Trigger on 3 consecutive frames with confidence <0.99
    - Trigger on bankroll/session limit exceeded
    - Halt all automated play and require manual restart
    - _Requirements: 10.5_
  
  - [ ] 11.4 Create status dashboard (optional)
    - Build web UI showing real-time component status
    - Display recent hands and metrics
    - Show alerts for degraded/failed components
    - _Requirements: 7.5_

- [ ] 12. Implement deterministic replay and RNG seeding
  - [ ] 12.1 Create seeded RNG system
    - Implement RNG interface with seed support
    - Generate seed from handId + sessionId hash
    - Use seeded RNG for all randomness (action selection, timing)
    - _Requirements: 10.1_
  
  - [ ] 12.2 Add model versioning and hashing
    - Track LLM model weights hashes
    - Track vision model versions
    - Track GTO cache versions
    - Include in HandRecord metadata
    - _Requirements: 10.2_

- [ ] 13. Wire components into main decision pipeline
  - [ ] 13.1 Create main orchestration loop
    - Implement pipeline: Vision → Parser → (GTO + Agents) → Strategy → Executor → Logger
    - Integrate Time Budget Tracker across all components
    - Add error handling and fallback policies
    - _Requirements: 7.1, 7.4_
  
  - [ ] 13.2 Add compliance validation at startup
    - Validate environment against config allowlist
    - Check for prohibited sites
    - Halt if compliance check fails
    - _Requirements: 0.5_
  
  - [ ] 13.3 Implement end-to-end decision flow
    - Ensure 2s deadline met at P95
    - Verify all components communicate correctly
    - Test with sample game states
    - _Requirements: 4.1_

- [ ] 14. Implement monitoring and observability
  - [ ] 14.1 Add structured logging
    - Implement log levels (DEBUG, INFO, WARN, ERROR, CRITICAL)
    - Log per-hand decisions and metrics
    - Log component failures and fallbacks
    - _Requirements: 7.1_
  
  - [ ] 14.2 Create metrics collection
    - Track performance metrics (latency P50/P95/P99, throughput)
    - Track decision quality metrics (win rate, EV accuracy, exploitability)
    - Track system health metrics (uptime, safe mode triggers, panic stops)
    - Track cost metrics (LLM tokens, solver time, $/1k hands)
    - _Requirements: 6.8_
  
  - [ ] 14.3 Add alerting system (optional)
    - Implement Slack/email alerts for critical errors
    - Add dashboard warnings for degraded performance
    - Generate daily summary reports
    - _Requirements: 7.5_

- [ ] 15. Create evaluation framework
  - [ ] 15.1 Implement offline evaluation smoke test
    - Create minimal simulator interface for smoke testing
    - Implement basic opponent (tight-aggressive or GTO)
    - Track win rate with 95% confidence intervals
    - Wire evaluation targets: ≥3bb/100 vs static pool, ≥0bb/100 vs mixed-GTO, ε≤0.02
    - _Requirements: 9.1, 9.2, 9.6, 9.7, 9.8_
  
  - [ ] 15.1b Expand offline evaluation to full 10M hand suite (optional)
    - Add full opponent pool (tight-aggressive, loose-passive, GTO, mixed-GTO)
    - Run 10M hand simulations
    - Measure exploitability vs baseline CFR bot
    - _Requirements: 9.1, 9.2, 9.6, 9.7, 9.8_
  
  - [ ] 15.2 Implement shadow mode harness
    - Compute decisions without executing actions
    - Support private/sim datasets only (no scraped hands from prohibited sites)
    - Create harness for running shadow mode sessions
    - _Requirements: 9.3_
  
  - [ ] 15.2b Run full shadow mode evaluation (optional)
    - Run for 100k hands minimum
    - Compare bot decisions to baseline decisions
    - Measure agreement rate and EV difference
    - _Requirements: 9.3_
  
  - [ ] 15.3 Create A/B testing framework (optional)
    - Support configuration variants (GTO-only vs blend, subgame vs no-subgame)
    - Run parallel experiments
    - Report results with confidence intervals
    - _Requirements: 9.4, 9.5_

- [ ] 16. Create deployment artifacts and CI pipeline
  - [ ] 16.1 Create Docker containers
    - Write Dockerfiles for each component
    - Pin all dependencies and base images
    - Include build metadata (timestamp, git commit)
    - _Requirements: 10.2_
  
  - [ ] 16.2 Set up container orchestration
    - Create Docker Compose configuration
    - Define inter-component communication (gRPC)
    - Configure volume mounts for cache, logs, config
    - _Requirements: 10.2_
  
  - [ ] 16.3 Add environment variable management
    - Set up .env file for API keys
    - Document required environment variables
    - Implement key rotation support
    - _Requirements: 10.2_
  
  - [ ] 16.4 Create CI pipeline
    - Set up build job for all components
    - Run vision golden tests in CI
    - Run required unit tests (SafeAction, RiskGuard, BudgetTracker, Config validator, Agent schema validator)
    - Fail build if latency P95 exceeds budget allocations
    - _Requirements: 1.2, 4.6, 10.4, 10.6, 8.6, 3.7_

- [ ] 17. Create documentation and examples (optional)
  - [ ] 17.1 Write configuration guide (optional)
    - Document all config parameters
    - Provide example configs for different game types
    - Explain tuning strategies (α adjustment, bet sizing, agent personas)
    - _Requirements: 8.1, 8.3, 8.4_
  
  - [ ] 17.2 Create operator manual (optional)
    - Document startup procedures
    - Explain monitoring dashboard
    - Provide troubleshooting guide
    - Document safe mode and panic stop recovery
    - _Requirements: 7.2, 7.5_
  
  - [ ] 17.3 Write developer guide (optional)
    - Document architecture and component interfaces
    - Explain how to add new LLM agents
    - Explain how to create new layout packs
    - Document evaluation procedures
    - _Requirements: 9.1, 9.2, 9.3_
