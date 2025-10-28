# Task 1 — Revised Sequential Order (Full Scaffolding + Core Interfaces)

Decision: gRPC codegen via Buf for TypeScript only; Rust uses tonic-build. TS stubs generated into `packages/shared/src/gen` for stable imports across packages.

## 0) Tooling and linting (enable Checkpoint 1 lint gate)

- Root ESLint config `.eslintrc.cjs` (TypeScript-aware parser):
```javascript
module.exports = {
  root: true,
  env: { es2022: true, node: true },
  parser: "@typescript-eslint/parser",
  parserOptions: { project: ["./tsconfig.base.json"], tsconfigRootDir: __dirname },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  ignorePatterns: ["dist/", "coverage/", "results/", "logs/", "packages/**/dist/**", "packages/shared/src/gen/**"],
};
```

- Root `.eslintignore`: `dist/\ncoverage/\nresults/\nlogs/\npackages/**/dist/\npackages/shared/src/gen/`.
- Hoist and pin core tooling in root `package.json` devDependencies (exact versions):
  - typescript 5.6.3, tsx 4.16.5, tsup 8.2.4
  - eslint 9.11.1, @typescript-eslint/parser 8.7.0, @typescript-eslint/eslint-plugin 8.7.0
  - vitest 2.1.3, @types/node 20.14.11
  - ajv 8.17.1
  - ts-proto 1.175.0, @grpc/grpc-js 1.11.1
  - prettier 3.3.3, eslint-config-prettier 9.1.0

## 1) Directory scaffolding (align with project_structure.md)

- `packages/orchestrator/` with `src/` subdirs: `config/`, `budget/`, `strategy/`, `safety/`, `solver_client/`, `agent_client/`, `execution/`, `logging/`, plus `test/` with basic specs.
- `packages/agents/` with `src/` subdirs: `coordinator.ts`, `personas/`, `schema/`, `transports/`; `test/agent_schema.spec.ts`.
- `packages/executor/` with `src/` subdirs: `simulators/`, `research_bridge.ts`, `verifier.ts`; `test/verifier.spec.ts`.
- `packages/logger/` with `src/` subdirs: `hand_history.ts`, `exporters/`; `test/retention.spec.ts`.
- `packages/shared/` with `src/` and `src/config/` and `src/gen/` (codegen target) and `test/`.
- `services/solver/` (Rust) with `src/`, `tests/`, `build.rs`, `Cargo.toml`.
- (Note) `services/vision/` already exists per setup; no changes in Task 1.

## 2) Per-package minimal build surfaces (avoid root build failures)

For each TS package (`orchestrator`, `agents`, `executor`, `logger`, `shared`):

- `package.json` scripts: `build` (tsc -p .), `lint` (eslint . --ext .ts), `test` (vitest run), `clean` (rimraf dist), `typecheck` (tsc -p . --noEmit).
- `tsconfig.json` extending root `tsconfig.base.json` with `composite: true`, `declaration: true`.
- Placeholder `src/index.ts` exporting a symbol used in a trivial test to ensure `build/test` pass.
- Add minimal ESLint config inheritance (or rely on root). Add a trivial `*.spec.ts` per package.

## 3) Root configs and scripts

- `tsconfig.base.json` at repo root for shared TS settings.
- Root `package.json` add scripts:
  - `proto:gen`: `buf generate proto`
  - `prebuild`: `pnpm run proto:gen` (guarantee codegen before TS build)
  - `build`: `pnpm -r --filter ./packages/** run build`
  - `lint`: `pnpm -r --filter ./packages/** run lint`
  - `test:unit`: `pnpm -r --filter ./packages/** run test`
  - Ensure `workspaces: ["packages/*"]` and Node/TS pins remain.
- Add `packages/shared/src/gen/.gitkeep` so initial build does not error if codegen hasn’t run yet.

## 4) Shared core types (complete, not minimal)

Implement in `packages/shared/src/types.ts` exactly per `design.md`:

- Enums/types: `Suit`, `Rank`, `Position` (BTN, SB, BB, UTG, MP, CO), `Street`.
- `Card`, `Action` (type: fold|check|call|raise; amount?; position; street), `RNG`.
- `GameState` skeleton per Design 3. Game State Parser section, including confidence fields and latency.
- Export all via `packages/shared/src/index.ts`.

## 5) Config schema and loader

- `packages/shared/src/config/types.ts`: `BotConfig` interface aligned with `design.md` (compliance, vision, gto, agents, strategy, execution, safety, logging).
- `packages/shared/src/config/loader.ts`: Ajv validator against `config/schema/bot-config.schema.json`; `loadConfig(path)` and `validate(config)` returning typed `BotConfig` or throwing detailed errors.
- Declare runtime dependency in `packages/shared/package.json` dependencies: `"ajv": "8.17.1"` (not devDependency), since loader imports Ajv at runtime.
- `packages/shared/src/config/index.ts`: re-export loader and types.
- Add a tiny test in `packages/shared/test/config.spec.ts` that loads `config/bot/default.bot.json` and validates.

## 6) Protobuf layout and codegen

- Create stubs at root `proto/`:
  - `solver.proto` (minimal `service Solver { rpc Solve(SubgameRequest) returns (SubgameResponse); }`).
  - Also add empty or placeholder services/messages for `vision.proto`, `agents.proto`, `strategy.proto`, `executor.proto`, `logging.proto` to lock topology; keep messages minimal.
- Add `proto/buf.gen.yaml` to generate TS using `ts-proto` with `grpc-js` into `packages/shared/src/gen`.
- Keep `proto/buf.yaml` as in setup.
- Root CI/build order: run `pnpm run proto:gen` explicitly before `pnpm run build` (and `prebuild` handles local runs).

## 7) Rust solver service stub (services/solver)

- `Cargo.toml` with exact version pins (`tonic`, `prost`, `tokio`). Commit `Cargo.lock`.
- `build.rs` invoking `tonic-build` on `proto/solver.proto` (and referencing path to root `proto`).
- `src/main.rs` standing up a tonic server with a no-op `Solve` handler returning fixed values.
- `tests/` optional for now; ensure `cargo build` succeeds on CI.

## 8) Orchestrator wiring (compile-only)

- `packages/orchestrator/src/solver_client/client.ts`: create `grpc-js` client using code in `packages/shared/src/gen`.
- `packages/orchestrator/src/main.ts`: load config via `shared/config`, optionally attempt a guarded `solve` call when `ORCH_PING_SOLVER=1`. Default to skipping network call to keep CI green if solver not running.
- Export a noop `run()` function; add one trivial test to validate type imports and config loading.

## 9) Reproducible builds (Req 10.2)

- Pin exact dependency versions in all new `package.json` and `Cargo.toml` files; hoist common tooling to root only.
- Commit `pnpm-lock.yaml` (already present) and new `Cargo.lock`.

## 10) Checkpoint 1 execution

- Commands to verify locally and in CI:
  - `pnpm install`
  - `pnpm run proto:gen`
  - `pnpm run build`
  - `pnpm run test:unit`
  - `cargo build --manifest-path services/solver/Cargo.toml`
- Criteria: all packages build/lint/test pass; orchestrator links to generated client; solver compiles; no lint failures.

## Notes

- Strategy module stays under `packages/orchestrator/src/strategy` per `project_structure.md` rather than a separate `packages/strategy`.
- TS codegen centralized in `packages/shared/src/gen` to avoid future reshuffles.
- Non-goals for Task 1: real service logic, cross-language wiring beyond compile-time checks, Dockerfiles (scheduled later).
