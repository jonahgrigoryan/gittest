# Agent Zero Setup Instructions for Poker Bot Codebase Review

## Prerequisites

1. **Agent Zero Installed**: Follow the installation guide at https://www.agent-zero.ai/p/docs/get-started/
2. **Docker Running**: Agent Zero should be accessible via web UI
3. **Codebase Access**: This repository should be accessible to Agent Zero

## Initial Configuration

### Step 1: Access Agent Zero Web UI
- Navigate to `http://localhost:50080` (or your configured port)
- Ensure Agent Zero is running and accessible

### Step 2: Configure AI Models
- Go to **Settings → External Services**
- Configure at least one model provider (OpenRouter recommended for quick start)
- Set up:
  - **Chat Model**: For code analysis and reasoning (e.g., `gpt-4.1`)
  - **Utility Model**: For internal tasks (can be same as Chat Model)
  - **Web Browser Model**: For browsing documentation if needed

### Step 3: Create Knowledge Base
- Go to **Knowledge** section
- Upload or create documents:
  - `AGENT_ZERO_REVIEW.md` (this codebase overview)
  - `AGENT_ZERO_ISSUES.md` (issue tracker template)
  - `AGENT_ZERO_SETUP.md` (this setup guide)
  - `requirements.md` (project requirements)
  - `design.md` (system design)
  - `AGENTS.md` (agents package documentation)
  - `docs/config_guide.md` (configuration guide)
  - `docs/env.md` (environment variables documentation)
  - `docs/troubleshooting.md` (troubleshooting guide)
  - `package.json` (root package configuration)
  - `config/bot/default.bot.json` (main bot configuration)
  - `tasks.md` (task breakdown and requirements)

### Step 4: Create Project Workspace
- Create a new project in Agent Zero called "Poker Bot Codebase Review"
- Set the project directory to this repository's root: `/Users/jonahgrigoryan/gittest`
- **Important**: This branch (`agent-zero-codebase-review`) contains the **merged main branch** with all tasks integrated. Agent Zero should review the bot as a complete, integrated system.

## Agent Zero Workflow

### Phase 1: Initial Assessment
**Prompt for Agent Zero:**
```
I need you to review the poker bot codebase located at /Users/jonahgrigoryan/gittest.

This is the merged main branch with all tasks integrated. Review the bot as a complete, integrated system.

Start by:
1. Reading AGENT_ZERO_REVIEW.md to understand the codebase structure and holistic review approach
2. Running `pnpm run build` and documenting any build errors
3. Running `pnpm run test` and documenting any test failures (especially integration tests)
4. Running `pnpm run typecheck` and documenting any type errors (focus on cross-module type issues)
5. Running `pnpm run lint` and documenting any linting issues
6. Reviewing logs in the results/ directory for runtime errors and integration failures
7. Running end-to-end functional tests to validate complete bot behavior

Document all findings in AGENT_ZERO_ISSUES.md, with special attention to integration problems.
```

### Phase 2: Integration-Focused Code Review
**Prompt for Agent Zero:**
```
Now perform a systematic code review with focus on integration:

1. Review integration points between packages:
   - How orchestrator integrates vision, solver, agents, and executor
   - Data flow between modules (game state → decision → execution)
   - How agent outputs are consumed by strategy engine
   - Configuration propagation across all modules
   - Error propagation and fallback mechanisms

2. Review each package's integration with others:
   - @poker-bot/orchestrator (main coordinator - most critical)
   - @poker-bot/agents (how it integrates with orchestrator and strategy)
   - @poker-bot/shared (shared types used across all packages)
   - @poker-bot/logger (how it captures data from all modules)
   - @poker-bot/executor (how it receives decisions from orchestrator)
   - @poker-bot/evaluator (how it tests the integrated system)

3. Look for integration-specific issues:
   - Type mismatches at module boundaries
   - Data serialization/deserialization problems
   - Cross-module error handling gaps
   - Configuration inconsistencies
   - Module interaction bugs
   - Race conditions in multi-module workflows
   - Memory leaks in integration paths

4. Verify end-to-end workflows work correctly
5. Test module interactions that weren't covered in individual task testing

Document findings in AGENT_ZERO_ISSUES.md, categorizing as integration issues.
```

### Phase 3: End-to-End Testing & Validation
**Prompt for Agent Zero:**
```
Now test the integrated system with end-to-end functional tests:

1. Run the full test suite: `pnpm run test`
   - Pay special attention to integration tests
   - Look for tests that span multiple packages
   - Identify missing integration test coverage

2. Run CI verification: `pnpm run ci:verify`
   - This validates the merged main branch
   - Note any issues that weren't caught during individual task CI

3. Test complete workflows:
   - Vision → Parser → Decision Pipeline → Execution
   - Agent coordination → Strategy blending → Action selection
   - Error handling across the entire pipeline
   - Configuration loading and propagation

4. Validate module interactions:
   - Test how one module's output becomes another's input
   - Verify data transformations between modules
   - Check error propagation and fallback mechanisms

5. Check for functional problems not caught in CI:
   - Runtime integration failures
   - Cross-module type mismatches
   - Configuration inconsistencies
   - End-to-end workflow breaks

6. Review test coverage for integration scenarios

Update AGENT_ZERO_ISSUES.md with test-related findings, especially integration test gaps.
```

### Phase 4: Fix Implementation
**Prompt for Agent Zero:**
```
Now implement fixes for the issues found:

1. Start with critical issues
2. Then high priority issues
3. For each fix:
   - Make minimal, focused changes
   - Add tests if missing
   - Verify the fix works
   - Update AGENT_ZERO_ISSUES.md with fix details

4. After each fix, run:
   - `pnpm run build`
   - `pnpm run test`
   - `pnpm run typecheck`
   - `pnpm run lint`

5. Document all changes clearly
```

### Phase 5: Verification
**Prompt for Agent Zero:**
```
Final verification:

1. Run complete build: `pnpm run build`
2. Run all tests: `pnpm run test`
3. Type check: `pnpm run typecheck`
4. Lint: `pnpm run lint`
5. CI verification: `pnpm run ci:verify`

Ensure all critical and high priority issues are fixed.
Create a summary of all fixes implemented.
```

## Useful Commands for Agent Zero

### Build Commands
```bash
# Build all packages
pnpm run build

# Build specific package
pnpm --filter "@poker-bot/agents" run build
pnpm --filter "@poker-bot/orchestrator" run build
```

### Test Commands
```bash
# Run all tests
pnpm run test

# Run tests for specific package
pnpm --filter "@poker-bot/agents" run test
```

### Analysis Commands
```bash
# Type check
pnpm run typecheck

# Lint
pnpm run lint

# CI verification
pnpm run ci:verify

# Environment validation
pnpm run verify:env
```

### Git Commands
```bash
# Check status
git status

# View changes
git diff

# Stage changes
git add .

# Commit changes (use descriptive messages)
git commit -m "M3: Agent Zero review - [description]"

# View commit history
git log --oneline -10

# Check branch status
git branch -v

# View differences from main
git diff main..agent-zero-codebase-review --stat
```

**Git Workflow for Agent Zero**:
- **Branch**: Work on `agent-zero-codebase-review` branch
- **Commit Frequently**: Commit each fix or set of related changes with descriptive messages
- **Track Changes**: Use `git diff` to review changes before committing
- **Document Fixes**: Include issue numbers in commit messages (e.g., "Fix ISSUE-001: integration failure")
- **Keep History Clean**: Make focused commits that are easy to review and understand
- **Before Pushing**: Ensure all tests pass and documentation is updated

## File Structure Reference

```
gittest/
├── packages/
│   ├── agents/          # Multi-LLM reasoning layer
│   ├── orchestrator/   # Main decision pipeline
│   ├── shared/         # Shared types & utilities
│   ├── logger/         # Hand history logging
│   ├── executor/       # Action execution
│   └── evaluator/      # Testing framework
├── services/
│   ├── solver/         # Rust GTO solver
│   └── vision/         # Python vision service
├── config/             # Configuration files
├── results/            # Logs and outputs
├── docs/               # Documentation
└── tools/              # Utility scripts
```

## Key Files to Review

### Critical Files
- `packages/orchestrator/src/main.ts` - Main entry point
- `packages/orchestrator/src/decision/pipeline.ts` - Decision pipeline
- `packages/orchestrator/src/strategy/engine.ts` - Strategy engine
- `packages/agents/src/coordinator.ts` - Agent coordinator
- `packages/shared/src/types.ts` - Type definitions

### Configuration Files
- `config/bot/default.bot.json` - Main configuration
- `package.json` - Root package config
- `pnpm-workspace.yaml` - Workspace config
- `tsconfig.base.json` - TypeScript config

### Documentation Files
- `requirements.md` - Project requirements
- `design.md` - System design
- `AGENTS.md` - Agents package docs
- `docs/config_guide.md` - Configuration guide

## Review Focus & Prioritization

Agent Zero should prioritize issues in this order:

1. **Critical Integration Failures**: Issues that break the entire bot or prevent end-to-end functionality
2. **Cross-Module Communication Problems**: Data flow issues between modules
3. **Functional Issues Not Caught in CI**: Problems that work in isolation but fail when integrated
4. **Test Coverage Gaps**: Missing integration tests or end-to-end test scenarios
5. **Flaky Tests**: Tests that pass/fail intermittently (indicate timing or state issues)
6. **High Priority Code Issues**: Type errors, configuration problems, error handling gaps
7. **Medium/Low Priority**: Code quality improvements, optimizations

**Review Strategy**: 
- Start with critical integration failures that prevent the bot from functioning
- Then focus on cross-module issues that affect multiple components
- Document root causes to help prevent similar issues
- Prioritize fixes that improve system stability and test coverage

## Tips for Agent Zero

1. **Read First**: Always read relevant documentation before making changes
2. **Test Often**: Run tests after each change, especially integration tests
3. **Small Changes**: Make focused, minimal changes
4. **Document**: Update issue tracker as you go, including root cause analysis
5. **Verify**: Always verify fixes work in the integrated system before moving on
6. **Track Coverage**: Note test coverage gaps and missing integration scenarios
7. **Git Workflow**: Commit changes frequently with descriptive messages
8. **Ask Questions**: If something is unclear, note it in the issues file

## Success Criteria

The review is complete when:
- ✅ All critical issues are fixed (especially integration issues)
- ✅ All high priority issues are fixed
- ✅ All tests pass (including integration tests)
- ✅ End-to-end functional tests validate complete bot behavior
- ✅ No type errors (especially at module boundaries)
- ✅ No linting errors
- ✅ Build succeeds
- ✅ CI verification passes
- ✅ Module interactions work correctly
- ✅ Integration problems identified and resolved
- ✅ All fixes are documented
- ✅ Code quality is maintained or improved

## Notes

- **Branch**: Work on `agent-zero-codebase-review` (contains merged main branch)
- **Review Approach**: Review the bot as a complete, integrated system, not individual tasks
- **Focus Areas**: 
  - Integration issues and end-to-end functionality
  - Cross-module communication and data flow
  - Functional problems not caught during CI testing
  - Test coverage gaps, especially integration tests
  - Root cause analysis for all issues found
- **Git Workflow**: 
  - Commit frequently with descriptive messages
  - Track changes through git history
  - Document fixes with issue numbers
- **Code Standards**: 
  - Follow existing code style
  - Maintain backward compatibility
  - Update tests when fixing bugs (especially integration tests)
  - Document breaking changes if any
- **Documentation**: 
  - Update AGENT_ZERO_ISSUES.md with all findings
  - Include root cause analysis for issues
  - Document test coverage gaps
  - Note patterns of integration issues

