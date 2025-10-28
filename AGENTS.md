# Repository Guidelines

## Project Structure & Module Organization
- `packages/agents`, `executor`, `logger`, `orchestrator`, `shared`: TypeScript workspaces; shared provides config schemas and generated protobuf bindings in `src/gen`.
- `services/solver`: Rust gRPC solver crate; build output stays in `services/solver/target`.
- `proto/`, `tools/`, `config/`, `infra/`, `native/`: protobuf sources, automation scripts, environment configs, infra helpers, and native bridges.
- `tests/`, `coverage/`, `logs/`, `results/`: integration scaffolding and CI artifacts; keep generated files out of Git unless explicitly tracked.

## Build, Test, and Development Commands
- `pnpm install`: install workspace deps (pnpm 9 per `.nvmrc`).
- `pnpm run verify:env`: confirm Node, pnpm, Python, `protoc`, and `buf` are on PATH.
- `pnpm run proto:gen`: regenerate TypeScript stubs after editing `proto/`; commits should include updated files in `packages/shared/src/gen`.
- `pnpm run build` | `pnpm run lint`: compile and lint every package; both must pass before opening a PR.
- `pnpm run test:unit`: run Vitest suites in each package; add `--watch` locally.
- `cargo test --manifest-path services/solver/Cargo.toml`: validate the Rust solver alongside JS tests.

## Coding Style & Naming Conventions
- Follow `.editorconfig`: two-space indentation, UTF-8, LF endings, final newline.
- Use `camelCase` for symbols, `PascalCase` for exports, `SCREAMING_SNAKE_CASE` for constants; prefer kebab-case filenames.
- Keep modules focused; re-export only from `packages/*/src/index.ts`; run `pnpm run lint -- --fix` or Prettier integration to resolve style issues.

## Testing Guidelines
- Place TypeScript specs beside the package under `test/` using `*.spec.ts` or `*.test.ts` mirrored to `src/`.
- Populate root-level `tests/` with multi-service or scenario flows and ensure `pnpm run test` reports the new cases.
- Use Vitest mocks for network boundaries and `tokio::test` for Rust async paths; document new flags or fixtures in `setup.md`.

## Commit & Pull Request Guidelines
- Prefer imperative, present-tense commit subjects under ~72 chars; conventional prefixes (`chore(ci): ...`) are welcome but optional.
- Keep generated outputs with their sources (e.g., commit `proto/` and `src/gen` together) and note behavioral changes in the commit body.
- PRs should list affected packages, link relevant design notes, and include the commands you ran (`pnpm run build`, `pnpm run lint`, `pnpm run test:unit`, Cargo tests).

## Proto & Native Tooling
- Update `.proto` definitions in lockstep with consumers, then run `pnpm run proto:gen` and `cargo build` before pushing.
- Coordinate Buf or Rust toolchain bumps via `setup.md` and notify infra owners when requirements change.
