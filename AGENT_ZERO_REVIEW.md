# Agent Zero Codebase Review Guide

## Overview

This document provides Agent Zero with comprehensive information to review, test, and fix issues in the poker bot codebase.

## Codebase Structure

### Monorepo Architecture
- **Package Manager**: pnpm workspaces
- **TypeScript**: All packages use TypeScript with strict type checking
- **Root**: `/Users/jonahgrigoryan/gittest`

### Core Packages

1. **`@poker-bot/agents`** (`packages/agents/`)
   - Multi-LLM reasoning layer
   - Personas: GTO Purist, Exploitative Aggressor, Risk-Averse Value
   - Coordinator, weighting engine, schema validation
   - **Key Files**: `src/coordinator.ts`, `src/personas/`, `src/weighting/`

2. **`@poker-bot/orchestrator`** (`packages/orchestrator/`)
   - Main decision-making pipeline
   - Integrates vision, GTO solver, agents, strategy engine
   - **Key Files**: `src/main.ts`, `src/decision/pipeline.ts`, `src/strategy/engine.ts`

3. **`@poker-bot/shared`** (`packages/shared/`)
   - Shared types, utilities, configuration
   - Game state definitions, action types
   - **Key Files**: `src/types.ts`, `src/config.ts`

4. **`@poker-bot/logger`** (`packages/logger/`)
   - Hand history logging
   - Structured logging with redaction
   - **Key Files**: `src/handHistory.ts`

5. **`@poker-bot/executor`** (`packages/executor/`)
   - Action execution (simulator/API)
   - Action verification
   - **Key Files**: `src/executor.ts`

6. **`@poker-bot/evaluator`** (`packages/evaluator/`)
   - Testing and evaluation framework
   - Smoke tests, AB testing
   - **Key Files**: `src/evaluator.ts`

### Services (Rust/Python)

1. **`services/solver/`** (Rust)
   - GTO solver implementation
   - Cached solutions
   - **Key Files**: `src/solver.rs`

2. **`services/vision/`** (Python)
   - Computer vision for game state parsing
   - Layout packs, ROI detection
   - **Key Files**: `src/vision.py`

## Testing Strategy

### 1. Build All Packages
```bash
# Build everything
pnpm run build

# Build specific package
pnpm --filter "@poker-bot/agents" run build
pnpm --filter "@poker-bot/orchestrator" run build
pnpm --filter "@poker-bot/shared" run build
pnpm --filter "@poker-bot/logger" run build
pnpm --filter "@poker-bot/executor" run build
pnpm --filter "@poker-bot/evaluator" run build
```

### 2. Run Tests
```bash
# Run all tests
pnpm run test

# Run tests for specific package
pnpm --filter "@poker-bot/agents" run test
pnpm --filter "@poker-bot/orchestrator" run test
pnpm --filter "@poker-bot/shared" run test
pnpm --filter "@poker-bot/logger" run test
pnpm --filter "@poker-bot/executor" run test
pnpm --filter "@poker-bot/evaluator" run test
```

### 3. Type Checking
```bash
# Type check all packages
pnpm run typecheck

# Type check specific package
pnpm --filter "@poker-bot/agents" run typecheck
```

### 4. Linting
```bash
# Lint all packages
pnpm run lint

# Lint specific package
pnpm --filter "@poker-bot/agents" run lint
```

### 5. CI Verification
```bash
# Run full CI verification
pnpm run ci:verify
```

### 6. Environment Validation
```bash
# Validate environment setup
pnpm run verify:env
```

## Log Locations

### Application Logs
- **Session Logs**: `results/session/health-*.jsonl`
- **Hand History**: `results/hands/session_*/`
- **Replay Reports**: `results/replay/report.json`

### Test Outputs
- **Test Results**: Check console output from `pnpm run test`
- **Coverage**: May be in `coverage/` directories (if configured)

### Build Artifacts
- **Dist Folders**: `packages/*/dist/`
- **Type Definitions**: `packages/*/dist/*.d.ts`

## Common Issues to Look For

### 1. Type Errors
- Check for TypeScript compilation errors
- Look for `any` types that should be properly typed
- Missing type definitions

### 2. Runtime Errors
- Check logs for runtime exceptions
- Look for unhandled promise rejections
- Memory leaks or resource issues

### 3. Integration Issues
- Package dependencies not resolving
- Configuration loading failures
- Missing environment variables

### 4. Test Failures
- Flaky tests
- Tests that should pass but don't
- Missing test coverage

### 5. Performance Issues
- Slow builds
- Memory usage spikes
- Timeout issues in tests

### 6. Configuration Issues
- Invalid config schema
- Missing required config values
- Config not loading properly

## Key Configuration Files

1. **`config/bot/default.bot.json`** - Main bot configuration
2. **`package.json`** - Root package.json with scripts
3. **`pnpm-workspace.yaml`** - Workspace configuration
4. **`tsconfig.base.json`** - Base TypeScript config
5. **`packages/*/tsconfig.json`** - Package-specific TS configs

## Environment Variables

Check `docs/env.md` for required environment variables. Common ones:
- API keys for LLM providers
- Database connections
- Service URLs

## Debugging Commands

```bash
# Check for uncommitted changes
git status

# View recent commits
git log --oneline -10

# Check package versions
pnpm list --depth=0

# Check for outdated packages
pnpm outdated

# Clear build artifacts
pnpm run clean

# Rebuild from scratch
pnpm run clean && pnpm run build
```

## Fix Workflow

1. **Identify Issue**: Review logs, test failures, or code inspection
2. **Create Test Case**: If possible, write a test that reproduces the issue
3. **Implement Fix**: Make minimal changes to fix the issue
4. **Verify Fix**: Run tests and build to ensure fix works
5. **Document**: Update this file or create issue notes

## Agent Zero Instructions

1. **Start with Build**: Run `pnpm run build` and note any errors
2. **Run Tests**: Execute `pnpm run test` and document failures
3. **Check Logs**: Review logs in `results/` directory
4. **Type Check**: Run `pnpm run typecheck` for type errors
5. **Lint**: Run `pnpm run lint` for code quality issues
6. **Review Code**: Systematically review each package
7. **Fix Issues**: Implement fixes with proper testing
8. **Document**: Update this file with findings and fixes

## Priority Areas

Based on the codebase structure, focus on:
1. **Orchestrator** - Main entry point, most critical
2. **Agents** - Complex multi-LLM coordination
3. **Shared Types** - Foundation for all packages
4. **Configuration** - System setup and validation
5. **Tests** - Ensure test suite is comprehensive

## Notes

- All code should be production-ready (no placeholders)
- Follow existing code style and patterns
- Maintain backward compatibility where possible
- Update tests when fixing bugs
- Document any breaking changes

