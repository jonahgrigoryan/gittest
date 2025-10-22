# Task 0 — Deterministic Bootstrap (precedes Task 1)

Purpose: lock reproducibility, standardize dev/CI, and wire shared outputs so AI agents can read results immediately. Choices below are fixed for Intel macOS and compatible with CI/Linux containers.

## Locked choices
- OS: macOS 14+ (Intel)
- Containers: Docker Desktop (Linux containers) + Compose
- Node: 20.17.0 via nvm; Package manager: pnpm 9.x; TypeScript: 5.6.x
- Python: 3.11.9 via pyenv; Dependency manager: Poetry 1.8.x
- Rust: 1.82.0 via rustup (for solver service)
- gRPC/Protos: protoc 26.x + buf 1.34.x; codegen: ts-proto (grpc-js), grpcio-tools (Py), tonic-build (Rust)
- TypeScript libs: eslint + @typescript-eslint, prettier, vitest, tsx, tsup, ajv (JSON Schema), pino (logging)
- Python libs (Vision): onnxruntime==1.18.1 (CPU only on Intel), numpy 2.1.x, opencv-python-headless 4.10.x, pillow, grpcio 1.65+, protobuf 5.x, pytest 8.x, ruff, black
- Logs/results: NDJSON logs in `logs/`; machine-readable test outputs in `results/`; single summary at `results/status.json`

## Steps to perform

### 1) Pin toolchains (create these files at repo root)
- `.nvmrc`
```text
v20.17.0
```
- `.python-version`
```text
3.11.9
```
- `rust-toolchain.toml`
```toml
[toolchain]
channel = "1.82.0"
components = ["clippy", "rustfmt"]
```

### 2) Initialize workspace skeleton
Create the following top-level directories (commit them, even if empty):
- `config/`, `proto/`, `packages/`, `services/`, `native/`, `tests/`, `tools/`, `infra/`, `results/`, `logs/`, `coverage/`
- Add `.gitkeep` inside `results/`, `logs/`, `coverage/` to keep them in git.

### 3) Root package.json (env checks + placeholder test)
Create `package.json` at repo root:
```json
{
  "name": "poker-bot",
  "private": true,
  "workspaces": ["packages/*"],
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "check:node": "node -e \"console.log(process.version)\"",
    "check:pnpm": "pnpm -v",
    "check:python": "python3 -V || python -V",
    "check:protoc": "protoc --version || echo 'protoc not installed'",
    "check:buf": "buf --version || echo 'buf not installed'",
    "verify:env": "pnpm run check:node && pnpm run check:pnpm && pnpm run check:python && pnpm run check:protoc && pnpm run check:buf",
    "test": "node tools/summarize.cjs"
  }
}
```

### 4) Results aggregator stub
Create `tools/summarize.cjs`:
```javascript
const fs = require('fs');
const path = require('path');
const outDir = path.resolve(__dirname, '..', 'results');
fs.mkdirSync(outDir, { recursive: true });
const status = {
  commit: process.env.GIT_COMMIT || null,
  timestamp: new Date().toISOString(),
  modules: {},
  overall: { ok: true }
};
fs.writeFileSync(path.join(outDir, 'status.json'), JSON.stringify(status, null, 2));
console.log('Wrote results/status.json');
```

### 5) Compose skeleton
Create `infra/compose/docker-compose.yml`:
```yaml
version: "3.9"
services:
  orchestrator:
    build: ../../packages/orchestrator
    volumes:
      - ../../:/workspace
      - ../../config:/config:ro
      - ../../results:/results
      - ../../logs:/logs
      - ../../coverage:/coverage
    working_dir: /workspace/packages/orchestrator
    command: ["pnpm","test"]
volumes: {}
```

### 6) Proto toolchain pins
Create `proto/buf.yaml`:
```yaml
version: v1
breaking:
  use:
    - FILE
lint:
  use:
    - DEFAULT
```
(We’ll wire code generation in Task 1.)

### 7) Base config stubs
- `config/schema/bot-config.schema.json`
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "BotConfig",
  "type": "object",
  "required": ["compliance","vision","gto","agents","strategy","execution","safety","logging"],
  "properties": {
    "compliance": { "type": "object" },
    "vision": { "type": "object" },
    "gto": { "type": "object" },
    "agents": { "type": "object" },
    "strategy": { "type": "object" },
    "execution": { "type": "object" },
    "safety": { "type": "object" },
    "logging": { "type": "object" }
  }
}
```
- `config/bot/default.bot.json`
```json
{
  "compliance": { "gameType": "NLHE_6max", "allowedEnvironments": ["simulator"], "siteAllowlist": [] },
  "vision": { "layoutPack": "simulator/default", "dpiCalibration": 1.0, "confidenceThreshold": 0.995, "occlusionThreshold": 0.05 },
  "gto": { "cachePath": "cache/preflop", "subgameBudgetMs": 400, "deepStackThreshold": 100 },
  "agents": { "models": [], "timeoutMs": 3000, "outputSchema": {} },
  "strategy": { "alphaGTO": 0.7, "betSizingSets": { "preflop": [], "flop": [], "turn": [], "river": [] }, "divergenceThresholdPP": 30 },
  "execution": { "mode": "simulator" },
  "safety": { "bankrollLimit": 0, "sessionLimit": 0, "panicStopConfidenceThreshold": 0.99, "panicStopConsecutiveFrames": 3 },
  "logging": { "retentionDays": 14, "exportFormats": ["json"] }
}
```

### 8) Dev standards
- `.editorconfig`
```ini
root = true
[*]
end_of_line = lf
insert_final_newline = true
charset = utf-8
indent_style = space
indent_size = 2
```
- `.gitattributes`
```text
* text=auto eol=lf
```
- `.gitignore`
```text
node_modules/
dist/
.venv/
.env
.DS_Store
coverage/
logs/
results/
```

### 9) Python env for Vision (Poetry)
Create `services/vision/pyproject.toml`:
```toml
[tool.poetry]
name = "vision"
version = "0.1.0"
package-mode = false

[tool.poetry.dependencies]
python = "3.11.9"
onnxruntime = "1.18.1"
numpy = "^2.1.0"
opencv-python-headless = "^4.10.0"
pillow = "^10.4.0"
grpcio = "^1.65.0"
protobuf = "^5.27.0"

[tool.poetry.group.dev.dependencies]
pytest = "^8.3.0"
ruff = "^0.6.0"
black = "^24.8.0"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
```
Intel macOS inference hint (to use later in code):
```python
import onnxruntime as ort
session = ort.InferenceSession("model.onnx", providers=["CPUExecutionProvider"])
```

### 10) CI skeleton (GitHub Actions)
Create `.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20.17.0, cache: 'pnpm' }
      - run: corepack enable
      - run: pnpm -v
      - run: pnpm install
      - run: pnpm run verify:env
      - uses: actions/setup-python@v5
        with: { python-version: '3.11.9' }
      - run: python -V
      - name: Aggregate results
        run: node tools/summarize.cjs
      - uses: actions/upload-artifact@v4
        with:
          name: results
          path: results/status.json
```

## Exit criteria (go/no-go to Task 1)
- `pnpm run verify:env` succeeds locally and in CI.
- `tools/summarize.cjs` writes `results/status.json`.
- `results/`, `logs/`, `coverage/` exist (with `.gitkeep`) and are mounted in Compose.
- Root standards committed: `.editorconfig`, `.gitattributes`, `.gitignore`.
- Toolchain pins present: `.nvmrc`, `.python-version`, `rust-toolchain.toml`.
- Docker Desktop installed and Compose file present.
