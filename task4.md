# Task 4: Implement GTO Solver

_Reference_: Requirements and detailed design live in `design.md §4` and the upstream Task 4 brief. This file tracks local implementation progress for the required checkpoints.

## Progress Checklist

- [x] **4.1 Cache layer** – state fingerprinting, manifest validation, preload, and sample preflop/flop cache directories.
- [x] **4.2 Subgame solver** – CFR scaffold, abstraction hooks, budget handling, exploitability metrics, and expanded gRPC surface.
- [x] **Proto updates + codegen** – `proto/solver.proto` aligned with new fields; TypeScript and Rust bindings updated.
- [x] **4.3 Deep-stack adjustments** – effective stack computation, action-set expansion, and propagation into solver requests.
- [x] **4.4–4.5 GTOSolution & orchestrator integration** – shared types, orchestrator solver module, client parsing, resilience/fallbacks, and end-to-end integration tests.

## Notes

- TypeScript lint/build/test suites (`pnpm -r --filter "./packages/**" run lint|build|test`) pass with the new solver pipeline.
- Rust solver crate builds, lints, and tests (`cargo fmt`, `cargo clippy`, `cargo test`) after installing `protobuf-compiler` to provide `protoc`.
- Cache fixtures under `config/cache/` are JSON for readability; the loader tolerates non-gzip entries while favouring compressed binaries in production.
