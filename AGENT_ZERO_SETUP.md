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
  - `requirements.md` (project requirements)
  - `design.md` (system design)
  - `AGENTS.md` (agents package documentation)

### Step 4: Create Project Workspace
- Create a new project in Agent Zero called "Poker Bot Codebase Review"
- Set the project directory to this repository's root: `/Users/jonahgrigoryan/gittest`

## Agent Zero Workflow

### Phase 1: Initial Assessment
**Prompt for Agent Zero:**
```
I need you to review the poker bot codebase located at /Users/jonahgrigoryan/gittest.

Start by:
1. Reading AGENT_ZERO_REVIEW.md to understand the codebase structure
2. Running `pnpm run build` and documenting any build errors
3. Running `pnpm run test` and documenting any test failures
4. Running `pnpm run typecheck` and documenting any type errors
5. Running `pnpm run lint` and documenting any linting issues
6. Reviewing logs in the results/ directory for runtime errors

Document all findings in AGENT_ZERO_ISSUES.md using the provided template.
```

### Phase 2: Code Review
**Prompt for Agent Zero:**
```
Now perform a systematic code review:

1. Review each package in packages/:
   - @poker-bot/orchestrator (most critical)
   - @poker-bot/agents
   - @poker-bot/shared
   - @poker-bot/logger
   - @poker-bot/executor
   - @poker-bot/evaluator

2. Look for:
   - Type safety issues
   - Error handling gaps
   - Race conditions
   - Memory leaks
   - Configuration issues
   - Missing tests
   - Code quality issues

3. Check integration points between packages
4. Verify configuration loading and validation
5. Review error handling and fallback mechanisms

Document findings in AGENT_ZERO_ISSUES.md.
```

### Phase 3: Testing & Validation
**Prompt for Agent Zero:**
```
Now test the system:

1. Run the full test suite: `pnpm run test`
2. Run CI verification: `pnpm run ci:verify`
3. Check for flaky tests or tests that should exist but don't
4. Review test coverage
5. Verify all integration points work correctly

Update AGENT_ZERO_ISSUES.md with test-related findings.
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

# Commit changes
git commit -m "M3: Agent Zero review - [description]"
```

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

## Tips for Agent Zero

1. **Read First**: Always read relevant documentation before making changes
2. **Test Often**: Run tests after each change
3. **Small Changes**: Make focused, minimal changes
4. **Document**: Update issue tracker as you go
5. **Verify**: Always verify fixes work before moving on
6. **Ask Questions**: If something is unclear, note it in the issues file

## Success Criteria

The review is complete when:
- ✅ All critical issues are fixed
- ✅ All high priority issues are fixed
- ✅ All tests pass
- ✅ No type errors
- ✅ No linting errors
- ✅ Build succeeds
- ✅ CI verification passes
- ✅ All fixes are documented
- ✅ Code quality is maintained or improved

## Notes

- Work on branch `agent-zero-codebase-review`
- Commit frequently with descriptive messages
- Follow existing code style
- Maintain backward compatibility
- Update tests when fixing bugs
- Document breaking changes if any

