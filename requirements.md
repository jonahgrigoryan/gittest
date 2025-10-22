# Requirements Document

## Introduction

This document specifies the requirements for an AI Poker Bot system that combines real-time computer vision, Game Theory Optimal (GTO) strategy solving, and multi-agent Large Language Model (LLM) reasoning to make autonomous strategic decisions in poker games. The system operates in an imperfect-information environment where it must process visual game state, compute optimal strategies, and coordinate multiple reasoning agents to make decisions that push the boundaries of autonomous poker play.

## Glossary

- **Vision System**: The computer vision subsystem that captures and interprets visual poker game state from screen or camera input
- **GTO Solver**: The Game Theory Optimal solver component that computes Nash equilibrium strategies for poker situations
- **Agent Coordinator**: The orchestration layer that manages multiple LLM reasoning agents and synthesizes their outputs
- **Game State Parser**: The component that converts visual input into structured poker game state data
- **Strategy Engine**: The decision-making component that combines GTO solutions with agent reasoning to select actions
- **LLM Reasoning Agent**: An individual language model instance that analyzes poker situations from a specific strategic perspective
- **Action Executor**: The component that translates decisions into game actions through simulator/API interfaces
- **Hand History Logger**: The component that records all game states, decisions, and outcomes for analysis
- **Effective Stack**: The smaller of two players' stack sizes in a heads-up confrontation
- **Exploitability (ε)**: The maximum expected value an opponent can achieve against a strategy
- **ACPC Format**: Agent-Centric Poker Competition format for standardized hand history representation
- **Subgame Solve**: Real-time computation of Nash equilibrium for a specific game tree branch
- **ROI (Region of Interest)**: Defined screen areas where visual elements are expected to appear
- **Brier Score**: Accuracy metric for probabilistic predictions

## Requirements

### Requirement 0

**User Story:** As an operator, I need a clearly bounded scope and compliance framework, so that the system runs only where permitted and adheres to platform terms of service

#### Acceptance Criteria

1. THE system SHALL declare game type (HU_NLHE or NLHE_6max), blind sizes, and ante rules in configuration
2. THE system SHALL operate only in private simulators, owned tables, or platforms with explicit API or bot permission
3. THE system SHALL refuse automation on platforms that prohibit bots in their terms of service
4. THE system SHALL implement no anti-detection features or mechanisms to circumvent bot detection
5. WHEN started, THE system SHALL validate environment permissions and halt if operating in a prohibited context

### Requirement 1

**User Story:** As a poker researcher, I want the system to capture real-time game state from visual input, so that the bot can operate in simulator environments with high accuracy and reliability

#### Acceptance Criteria

1. WHEN a poker game frame is captured, THE Vision System SHALL extract card values, suits, pot size, stack sizes, and player positions within 50 milliseconds at 95th percentile
2. WHEN more than 5% of a card ROI is occluded OR confidence is below 0.995, THE Vision System SHALL flag incomplete state, block action execution, and fall back to cached policy or check/fold
3. THE Vision System SHALL achieve 99.5% accuracy in card recognition across standard poker card designs
4. WHEN the game state changes, THE Game State Parser SHALL convert visual data into structured JSON format within 20 milliseconds at 95th percentile
5. THE Vision System SHALL support multiple poker platform layouts through configurable ROI layout packs with DPI calibration and per-theme templates
6. THE Vision System SHALL maintain pot and stack absolute error of 1 big blind or less at 95th percentile
7. THE Vision System SHALL report per-hand confidence scores for all extracted game state elements
8. THE Game State Parser SHALL assign BTN, SB, BB and positions correctly with state-sync error of 0.1% or less per hand
9. THE Vision System SHALL log per-module latency and confidence per hand for cards, stacks, pot, and positions

### Requirement 2

**User Story:** As a poker strategist, I want the system to compute GTO solutions for current game situations, so that decisions are grounded in mathematically optimal play

#### Acceptance Criteria

1. THE GTO Solver SHALL implement cache-first policy for preflop and common flop situations
2. WHEN a decision point requires real-time computation, THE GTO Solver SHALL allocate maximum 400 milliseconds for local subgame solve
3. THE GTO Solver SHALL support preflop, flop, turn, and river decision points with appropriate abstractions
4. WHEN effective stack exceeds 100 big blinds, THE GTO Solver SHALL apply deep-stack adjustments to strategy calculations
5. THE GTO Solver SHALL output action probabilities, expected values, and regret deltas for all available actions
6. WHEN total decision time budget would be exceeded, THE GTO Solver SHALL return cached policy immediately

### Requirement 3

**User Story:** As an AI researcher, I want multiple LLM agents to analyze poker situations from different strategic perspectives, so that the system captures diverse reasoning approaches

#### Acceptance Criteria

1. THE Agent Coordinator SHALL instantiate at least 3 LLM Reasoning Agents with distinct strategic priors
2. WHEN a decision is required, THE Agent Coordinator SHALL query all active LLM Reasoning Agents in parallel with 3 second timeout
3. THE Agent Coordinator SHALL serve as the sole decision arbiter, with LLM Reasoning Agents producing analysis and confidence scores only
4. THE Agent Coordinator SHALL calibrate agent weighting on a labeled validation set
5. THE Agent Coordinator SHALL track Brier score for each LLM Reasoning Agent across all decisions
6. THE LLM Reasoning Agents SHALL NOT execute actions directly
7. THE Agent Coordinator SHALL enforce a strict JSON schema for agent outputs, discarding malformed outputs and counting them toward timeout

### Requirement 4

**User Story:** As a poker player, I want the system to synthesize GTO solutions with multi-agent reasoning to make final decisions, so that play balances mathematical optimality with adaptive strategic thinking

#### Acceptance Criteria

1. THE Strategy Engine SHALL select a final action within 2 seconds end-to-end at 95th percentile
2. THE Strategy Engine SHALL blend strategies using formula: α × GTO + (1-α) × Exploit, where α is runtime-tunable within bounds [0.3, 0.9]
3. WHEN GTO and agent recommendations diverge by more than 30 percentage points, THE Strategy Engine SHALL log full trace including state, RNG seeds, and model hashes
4. THE Strategy Engine SHALL support runtime adjustment of α parameter without system restart
5. WHEN facing time pressure, THE Strategy Engine SHALL default to GTO solutions if agent reasoning is incomplete
6. THE Strategy Engine SHALL enforce a global 2 second deadline by tracking remaining budget and preempting lower-priority modules
7. THE Strategy Engine SHALL select bet sizes from a configurable discrete set per street and stack depth

### Requirement 5

**User Story:** As a system operator, I want the bot to execute decisions through simulator or API interfaces, so that the system operates autonomously in permitted environments

#### Acceptance Criteria

1. THE Action Executor SHALL use simulator or API interfaces as the default execution method
2. WHERE research UI mode is enabled, THE Action Executor SHALL require explicit allowlist configuration and site permission flag
3. WHEN research UI mode is requested for a prohibited site, THE Action Executor SHALL refuse execution
4. THE Action Executor SHALL verify action execution by comparing post-action visual state to expected state
5. WHEN action verification detects a mismatch, THE Action Executor SHALL re-evaluate once then halt execution
6. THE Action Executor SHALL support fold, check, call, and bet/raise actions with precise bet sizing through the configured interface

### Requirement 5.7 (NEW)

**User Story:** As an operator using research UI mode, I want the bot to detect poker windows and execute actions by clicking buttons when it's my turn

#### Acceptance Criteria

1. THE system SHALL detect opened poker GUI windows by title/process name patterns
2. THE system SHALL validate detected windows against allowlist before interaction
3. THE system SHALL identify when it is the hero's turn to act
4. THE system SHALL locate action buttons (fold, check, call, raise) on screen with >99% accuracy
5. THE system SHALL convert layout ROI coordinates to screen coordinates for clicking
6. THE system SHALL execute actions through mouse clicks with randomized timing (1-3s)
7. WHEN button detection fails, THE system SHALL fall back to SafeAction and alert operator

### Requirement 6

**User Story:** As a poker analyst, I want comprehensive logging of all game states and decisions, so that I can analyze bot performance and improve strategies

#### Acceptance Criteria

1. THE Hand History Logger SHALL record per-hand: raw state, parsed state JSON, solver outputs, agent analysis texts, final action, timings, RNG seeds, and model weight hashes
2. WHEN a hand completes, THE Hand History Logger SHALL persist data to storage within 1 second
3. THE Hand History Logger SHALL include timestamps with millisecond precision for all events
4. THE Hand History Logger SHALL export data in both JSON and ACPC-compatible formats
5. THE Hand History Logger SHALL redact personally identifiable information from all logs
6. THE Hand History Logger SHALL support configurable retention windows for log data
7. THE Hand History Logger SHALL track win rate, expected value accuracy, and decision quality metrics across sessions
8. THE system SHALL record latency distributions per module (P50, P95, P99) each session

### Requirement 7

**User Story:** As a developer, I want the system to handle errors gracefully and maintain stability, so that the bot can run for extended sessions without crashes

#### Acceptance Criteria

1. WHEN any component encounters an error, THE system SHALL log the error with full context and continue operation if possible
2. WHEN a critical component fails, THE system SHALL enter safe mode, lock the Action Executor, and continue logging
3. THE system SHALL implement health checks for all major components every 5 to 10 seconds
4. WHEN network connectivity to LLM services is lost, THE system SHALL fall back to GTO-only decision making
5. THE system SHALL provide real-time status monitoring through a dashboard interface

### Requirement 8

**User Story:** As a poker bot operator, I want configurable parameters for all major components, so that I can tune the system for different game types and strategic approaches

#### Acceptance Criteria

1. THE system SHALL load configuration from a structured file at startup
2. THE system SHALL support hot-reload of configuration changes without system restart
3. THE system SHALL allow configuration of LLM agent personas, model selection, and prompt templates
4. THE system SHALL support multiple vision configuration profiles for different poker platforms
5. WHEN configuration is updated, THE system SHALL validate parameters against a defined schema
6. WHEN configuration validation fails, THE system SHALL rollback to the previous valid configuration and log the error with clear messages

### Requirement 9

**User Story:** As a poker researcher, I want rigorous evaluation protocols for the system, so that I can measure performance and validate improvements

#### Acceptance Criteria

1. THE system SHALL support offline evaluation mode with at least 10 million hands against a static opponent pool
2. WHEN offline evaluation completes, THE system SHALL report big blinds per 100 hands, exploitability, and latency distributions
3. THE system SHALL support online shadow mode where decisions are computed but not executed for at least 100,000 hands
4. THE system SHALL support A/B testing configurations including GTO-only vs blend and no-subgame vs subgame comparisons
5. WHEN A/B testing completes, THE system SHALL report results with confidence intervals
6. THE system SHALL achieve offline win rate of 3 big blinds per 100 hands or greater vs static pool with 95% confidence interval not crossing 0
7. THE system SHALL achieve win rate of 0 big blinds per 100 hands or greater within 95% confidence interval against mixed GTO benchmark
8. THE system SHALL achieve exploitability of 0.02 or less versus a baseline CFR bot of record

### Requirement 10

**User Story:** As a system operator, I want deterministic behavior and safety controls, so that the system is reproducible and operates within risk limits

#### Acceptance Criteria

1. THE system SHALL use fixed RNG seeds per hand for reproducible decision making
2. THE system SHALL support reproducible container builds with pinned dependencies
3. WHEN LLM timeout occurs OR vision confidence is low, THE system SHALL fall back to cached policy or safe action
4. THE system SHALL enforce configurable bankroll and session limits
5. WHEN state confidence drops below 0.99 for 3 or more consecutive frames, THE system SHALL execute panic stop and halt all automated play
6. THE system SHALL implement a SafeAction policy: preflop check if allowed else fold, postflop check if allowed else fold, forced actions honored, blinds auto-posted, all-in only when required by prior commitment
