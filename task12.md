# Task 12 – Deterministic Replay and RNG Seeding

**Objective:** Implement a production-ready deterministic replay system by standardizing RNG seed generation from handId+sessionId hash and tracking all model versions (LLM weights, vision models, GTO cache) in HandRecord metadata. This enables exact replay of any hand by providing the same seed and model versions.

Task 12 builds on Task 10 (Hand History Logger) and Task 11 (Health Monitor) to ensure complete reproducibility. The deliverable must satisfy Requirements 10.1 and 10.2 from `tasks.md`.

---

## Prerequisites & Dependencies

- Tasks 1–11 merged (all components wired, logging infrastructure available).
- `packages/orchestrator` uses `ActionSelector` with `SeededRNG` (Task 8).
- `HandRecord` metadata structure exists (Task 10) but needs extension for model hashes.
- Session ID generation exists in `packages/orchestrator/src/main.ts` (line 202).
- Config manager exposes `strategy.rngSeed` (optional override).

Verification commands before declaring Task 12 complete:

```bash
pnpm --filter "@poker-bot/orchestrator" lint
pnpm --filter "@poker-bot/orchestrator" test
pnpm --filter "@poker-bot/orchestrator" build
pnpm --filter "@poker-bot/shared" test
pnpm --filter "@poker-bot/logger" test
```

---

## Architecture Overview

1. **RNG Seed Standardization (`packages/orchestrator/src/strategy/selection.ts`)**

            - Standardize seed generation: `hash(handId + sessionId)` for all randomness.
            - Ensure ActionSelector always uses deterministic seed derivation.
            - Update `deriveRngForDecision` to use standardized seed function.

2. **Model Version Tracking (`packages/shared/src/strategy.ts`)**

            - Extend `HandRecord.metadata` to include `modelVersions` object.
            - Define `ModelVersions` interface with LLM, vision, and GTO cache version fields.

3. **Model Version Collectors**

            - **LLM Model Hasher (`packages/agents/src/coordinator.ts`)**: Compute hash of model identifiers + weights metadata.
            - **Vision Model Version (`packages/orchestrator/src/vision/client.ts`)**: Query vision service for model versions.
            - **GTO Cache Version (`packages/orchestrator/src/solver/cache/fingerprint.ts`)**: Track cache manifest version.

4. **Orchestrator Integration (`packages/orchestrator/src/main.ts`)**

            - Collect model versions at hand start.
            - Pass model versions to `buildHandRecord`.
            - Ensure RNG seed is logged in HandRecord metadata.

5. **Testing & Validation**

            - Unit tests for seed generation determinism.
            - Integration tests for model version collection.
            - Replay tests: same seed + state → same decision.

---

## Detailed Step-by-Step Plan

### 1. Standardize RNG Seed Generation (Req 10.1)

#### 1.1 Create Centralized Seed Function

**File**: `packages/shared/src/rng.ts` (new)

Create shared RNG utilities:

```typescript
/**
 * Generate deterministic RNG seed from handId and sessionId.
 * Uses FNV-1a hash for fast, deterministic hashing.
 * 
 * @param handId - Unique hand identifier
 * @param sessionId - Session identifier (from env or timestamp)
 * @returns 32-bit unsigned integer seed
 */
export function generateRngSeed(handId: string, sessionId: string): number {
  const input = `${handId}:${sessionId}`;
  let hash = 2166136261; // FNV offset basis
  
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619); // FNV prime
  }
  
  return hash >>> 0; // Ensure unsigned 32-bit
}

/**
 * Validate seed is a valid 32-bit unsigned integer.
 */
export function validateSeed(seed: number): boolean {
  return Number.isFinite(seed) && seed >= 0 && seed <= 0xFFFFFFFF;
}
```

Export via `packages/shared/src/index.ts`:

```typescript
export * from "./rng";
```

> **Note:** `generateRngSeed` becomes the canonical seed derivation helper. Any module that currently hashes IDs locally or relies on `Math.random()` must import this helper (or the resulting `SeededRNG`) so that Task 12 fully owns randomness determinism.

#### 1.2 Update ActionSelector to Use Standardized Seed

**File**: `packages/orchestrator/src/strategy/selection.ts`

Update `ActionSelector.createRNG`:

- Import `generateRngSeed` from `@poker-bot/shared`.
- Change `hashStringToSeed` to use `generateRngSeed(handId, sessionId)`.
- Remove `hashStringToSeed` private method (replaced by shared function).
- Update `createRNG` signature: `createRNG(handId: string, sessionId: string): RNG`.
- If `baseSeed` is provided (config override), use it directly; otherwise derive from handId+sessionId.

Update `deriveRngForDecision`:

- Accept `sessionId` parameter.
- Pass both `handId` and `sessionId` to `selector.createRNG`.

#### 1.3 Update StrategyEngine to Pass SessionId

**File**: `packages/orchestrator/src/strategy/engine.ts`

Update `decide` method signature:

- Add `sessionId: string` parameter.
- Pass `sessionId` to `deriveRngForDecision`.

Update `buildMetadata` method:

- Ensure `rngSeed` is always set (use derived seed if not in config).

#### 1.4 Update Orchestrator Main Loop

**File**: `packages/orchestrator/src/main.ts`

In `makeDecision` function:

- Pass `sessionId` to `strategyEngine.decide(state, gtoResult, agents, sessionId)`.
- Ensure RNG seed is captured from decision metadata and logged.

Update `buildHandRecord`:

- Extract `rngSeed` from `decision.metadata.rngSeed`.
- Include in HandRecord (already present in `decision.metadata`, but verify).

#### 1.5 RNG Audit & Integration (Req 10.1)

- Perform a repo-wide audit for `Math.random`, `SeededRNG.create()`, ad-hoc hash seeds, and jitter/backoff helpers introduced in Tasks 6–11 (e.g., agent timeout jitter, executor retry delays, telemetry sampling).
- Minimum modules to audit (extend list as you find more call sites):
  - `packages/orchestrator/src/agents/client.ts` (timeout jitter + randomized persona ordering)
  - `packages/orchestrator/src/execution/index.ts` and `execution/retry.ts` (retry/backoff jitter)
  - `packages/orchestrator/src/logging/telemetry.ts` (sampling)
  - `packages/orchestrator/src/health/safe_mode.ts` (SafeAction fallbacks)
  - `packages/orchestrator/src/strategy/selection.ts` (already covered but verify)
  - `packages/orchestrator/src/utils/timing.ts` (any randomized delays)
- For each call site, ensure the RNG seed ultimately comes from `generateRngSeed(handId, sessionId)` (optionally offset with deterministic counters, e.g., `seed + retryIndex`).
- Update SafeMode/SafeAction fallbacks (Task 11) so even when the executor short-circuits, the metadata retains the derived seed. This guarantees replayable outcomes regardless of pipeline branch.
- Document the audited modules and resulting seed wiring in `progress.md` to maintain traceability for future tasks.

#### 1.6 Unit Tests for Seed Generation

**File**: `packages/shared/test/rng.spec.ts` (new)

Test cases:

- Same handId+sessionId → same seed.
- Different handId → different seed.
- Different sessionId → different seed.
- Edge cases: empty strings, special characters.
- Seed validation: valid 32-bit unsigned integers.

**File**: `packages/orchestrator/test/strategy/selection.spec.ts` (update)

Test cases:

- `createRNG` with handId+sessionId produces deterministic seeds.
- Config override (`baseSeed`) takes precedence.
- Multiple calls with same inputs produce same RNG sequence.

---

### 2. Model Version Tracking (Req 10.2)

#### 2.1 Extend HandRecord Metadata Types

**File**: `packages/shared/src/strategy.ts`

Add `ModelVersions` interface:

```typescript
export interface ModelVersions {
  llm?: {
    [agentId: string]: {
      modelId: string;
      provider: string;
      weightsHash?: string; // Hash of model weights metadata (if available)
      version?: string; // Model version string from provider
    };
  };
  vision?: {
    modelFiles: string[]; // e.g., ["card_rank.onnx", "card_suit.onnx", "digit.onnx"]
    versions?: Record<string, string>; // File -> version mapping
    modelDir?: string; // Path to model directory
  };
  gtoCache?: {
    manifestVersion: string; // From cache manifest
    fingerprintAlgorithm: string; // e.g., "sha256:v1"
    cachePath?: string;
  };
}
```

Update `HandRecord.metadata`:

```typescript
export interface HandRecord {
  // ... existing fields ...
  metadata: {
    configHash: string;
    rngSeed: number; // Add if not already present
    redactionApplied: boolean;
    redactedFields?: string[];
    healthSnapshotId?: string;
    modelVersions?: ModelVersions; // NEW
  };
}
```

Update `SerializedStrategyDecision.metadata`:

- Ensure `rngSeed` is included (already present, verify).

Export `ModelVersions` via `packages/shared/src/index.ts`.

#### 2.2 Create LLM Model Version Collector

**File**: `packages/agents/src/coordinator/version.ts` (new)

Create function to collect LLM model versions:

```typescript
import type { ModelVersions } from "@poker-bot/shared";

export interface LLMModelInfo {
  agentId: string;
  modelId: string;
  provider: string;
  weightsHash?: string;
  version?: string;
}

/**
 * Collect LLM model version information from agent coordinator.
 * Called once per session or when model configuration changes.
 */
export function collectLLMModelVersions(
  coordinator: AgentCoordinator
): ModelVersions["llm"] {
  const versions: ModelVersions["llm"] = {};
  
  // Iterate through configured agents/personas
  // Extract modelId, provider from transport configs
  // Compute weightsHash if model metadata available (optional)
  // Return map of agentId -> model info
  
  return versions;
}
```

**Integration**:

- Add method to `AgentCoordinator` class: `getModelVersions(): ModelVersions["llm"]`.
- Query each transport for model identifier.
- For OpenAI/Anthropic: use model ID string.
- For local models: compute hash of model file paths + sizes (if accessible).

#### 2.3 Create Vision Model Version Collector

**File**: `packages/orchestrator/src/vision/version.ts` (new)

Create function to query vision service for model versions:

```typescript
import type { ModelVersions } from "@poker-bot/shared";
import type { VisionClient } from "./client";

/**
 * Query vision service for model version information.
 * Calls gRPC method GetModelVersions if available, otherwise falls back to config.
 */
export async function collectVisionModelVersions(
  client: VisionClient,
  modelDir?: string
): Promise<ModelVersions["vision"]> {
  // Option 1 (preferred): Call vision service gRPC method (if implemented) to obtain file names + semantic versions.
  // Option 2 (baseline): Read model directory and hash file names + sizes for deterministic fingerprinting.
  // Return modelFiles array and optional versions map; always fall back to config-based metadata so HandRecords stay complete.
  const resolvedDir = modelDir ?? client.getConfig().modelDir;
  const files = await readVisionModelsFromFs(resolvedDir); // helper that lists *.onnx, computes sha256
  return {
    modelFiles: files.map((f) => f.name),
    versions: Object.fromEntries(files.map((f) => [f.name, f.sha256])),
    modelDir: resolvedDir
  };
}
```

**Vision Service Extension** (optional, if gRPC method added):

- Add `GetModelVersions` RPC to `proto/vision.proto`.
- Implement in `services/vision/src/vision/server.py`.
- Return model file names and versions.

**Fallback**: If gRPC method not available, use config-based approach:

- Read `vision.modelDir` from config.
- List ONNX files in directory and compute SHA256 hashes via `node:crypto`.
- Store `modelFiles`, `versions`, and `modelDir` in the returned payload; if directory read fails, log warning and return `{ modelFiles: [], versions: {}, modelDir, error: err.message }`.

#### 2.4 Create GTO Cache Version Collector

**File**: `packages/orchestrator/src/solver/cache/version.ts` (new)

Create function to read cache manifest version:

```typescript
import type { ModelVersions } from "@poker-bot/shared";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Read GTO cache manifest version from cache directory.
 */
export async function collectGTOCacheVersion(
  cachePath: string
): Promise<ModelVersions["gtoCache"]> {
  const manifestPath = resolve(cachePath, "cache_manifest.json");
  
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    return {
      manifestVersion: manifest.version || "unknown",
      fingerprintAlgorithm: manifest.fingerprintAlgorithm || "sha256:v1",
      cachePath
    };
  } catch (error) {
    // Fallback if manifest doesn't exist
    return {
      manifestVersion: "unknown",
      fingerprintAlgorithm: "sha256:v1",
      cachePath
    };
  }
}
```

- `cachePath` comes from orchestrator config (`config.strategy.solver.cachePath`); `main.ts` should pass the same path used by the solver loader so the manifest and loaded cache stay consistent.

**Cache Manifest Schema** (if not exists, create `config/cache/cache_manifest.json`):

```json
{
  "version": "1.0.0",
  "fingerprintAlgorithm": "sha256:v1",
  "createdAt": "2024-01-01T00:00:00Z",
  "cacheEntries": []
}
```

#### 2.5 Create Model Version Aggregator

**File**: `packages/orchestrator/src/version/collector.ts` (new)

Create `ModelVersionCollector` class:

```typescript
import type { ModelVersions } from "@poker-bot/shared";
import type { VisionClient } from "../vision/client";
import type { AgentCoordinator } from "@poker-bot/agents";
import { collectVisionModelVersions } from "../vision/version";
import { collectGTOCacheVersion } from "../solver/cache/version";
import { collectLLMModelVersions } from "@poker-bot/agents/coordinator/version";

export class ModelVersionCollector {
  private cachedVersions: ModelVersions | null = null;
  private lastCollectionTime: number = 0;
  private readonly cacheTTLMs: number;

  constructor(
    private visionClient: VisionClient,
    private agentCoordinator: AgentCoordinator,
    private cachePath: string,
    options?: { cacheTTLMs?: number }
  ) {
    this.cacheTTLMs = options?.cacheTTLMs ?? 0; // default: refresh every hand
  }

  /**
   * Collect all model versions (cached for TTL).
   */
  async collect(): Promise<ModelVersions> {
    const now = Date.now();
    
    if (
      this.cacheTTLMs > 0 &&
      this.cachedVersions &&
      (now - this.lastCollectionTime) < this.cacheTTLMs
    ) {
      return this.cachedVersions;
    }

    const [llm, vision, gtoCache] = await Promise.all([
      Promise.resolve(collectLLMModelVersions(this.agentCoordinator)),
      collectVisionModelVersions(this.visionClient, undefined),
      collectGTOCacheVersion(this.cachePath)
    ]);

    this.cachedVersions = {
      llm: Object.keys(llm || {}).length > 0 ? llm : undefined,
      vision,
      gtoCache
    };
    
    this.lastCollectionTime = now;
    return this.cachedVersions;
  }

  /**
   * Force refresh (clear cache and re-collect).
   */
  async refresh(): Promise<ModelVersions> {
    this.cachedVersions = null;
    return this.collect();
  }
}
```

- Default TTL of `0` means the orchestrator re-collects model versions at the start of every hand, guaranteeing metadata reflects any hot-swapped persona, vision build, or cache manifest. If operators configure a non-zero TTL for performance, `run()` must also subscribe to coordinator/vision/cache “refresh” events and call `modelVersionCollector.refresh()` whenever underlying assets change so we never log stale versions.
- Wrap the three collectors in `Promise.allSettled` so a single transient failure (e.g., vision service unavailable) does not block HandRecord creation. Log per-source errors and populate `undefined` for the failing component while preserving the others.

#### 2.6 Integrate Model Version Collection in Orchestrator

**File**: `packages/orchestrator/src/main.ts`

In `run()` function:

- Instantiate `ModelVersionCollector` after creating `visionClient`, `agentCoordinator`, and `cacheLoader`.
- Pass collector to `makeDecision` closure and subscribe to coordinator/vision/cache reload hooks so `collector.refresh()` runs immediately after any asset swap (e.g., persona change, vision hot reload, cache manifest rebuild).

In `makeDecision` function:

- Call `modelVersionCollector.collect()` at hand start so each `HandRecord` captures the exact versions used for that decision.
- Pass `modelVersions` to `buildHandRecord`.

Update `buildHandRecord`:

- Accept `modelVersions?: ModelVersions` parameter.
- Include in `HandRecord.metadata.modelVersions`.

---

### 3. RNG Seed Logging Verification

#### 3.1 Ensure RNG Seed in HandRecord

**File**: `packages/orchestrator/src/main.ts`

Verify `buildHandRecord` includes `rngSeed`:

- Extract from `decision.metadata.rngSeed`.
- Ensure it's logged even if decision uses fallback (GTO-only, SafeAction).

**File**: `packages/shared/src/strategy.ts`

Verify `SerializedStrategyDecision.metadata` includes `rngSeed`:

- Check existing type definition.
- Ensure all decision paths set `rngSeed` in metadata.

#### 3.2 Update Serialization Helpers

**File**: `packages/shared/src/strategy.ts`

In `serializeStrategyDecision`:

- Ensure `metadata.rngSeed` is preserved.
- Verify `modelVersions` serialization (if added to decision metadata, otherwise handled in HandRecord).

---

### 4. Testing & Validation

#### 4.1 Unit Tests

**File**: `packages/shared/test/rng.spec.ts`

Test `generateRngSeed`:

- Deterministic: same inputs → same output.
- Collision resistance: different inputs → different outputs (with high probability).
- Edge cases: empty strings, very long strings, special characters.
- Validation: output is valid 32-bit unsigned integer.

**File**: `packages/orchestrator/test/strategy/selection.spec.ts`

Test `ActionSelector.createRNG`:

- Uses standardized seed function.
- Config override works.
- RNG sequence is deterministic for same seed.

**File**: `packages/orchestrator/test/version/collector.spec.ts` (new)

Test `ModelVersionCollector`:

- Caching works (returns cached within TTL).
- Refresh clears cache.
- Handles missing vision/agent/cache gracefully.

#### 4.2 Integration Tests

**File**: `packages/orchestrator/test/integration/replay.spec.ts` (new)

Test deterministic replay:

- Create two `makeDecision` calls with same `handId`, `sessionId`, `GameState`.
- Verify same `rngSeed` generated.
- Verify same action selected (if distributions identical).
- Verify model versions collected and logged.
- Force a SafeMode scenario (e.g., mock HealthMonitor forcing SafeAction) and confirm the executor still reports the same derived `rngSeed`/metadata when replayed.

**File**: `packages/orchestrator/test/integration/model_versions.spec.ts` (new)

Test model version collection:

- Mock vision client, agent coordinator, cache loader.
- Verify all model versions collected.
- Verify versions included in HandRecord.

#### 4.3 Manual Validation

**Steps**:

1. Run orchestrator with known `SESSION_ID`.
2. Process a hand with known `handId`.
3. Check log file: verify `rngSeed` matches `hash(handId + sessionId)`.
4. Verify `modelVersions` present in HandRecord.
5. Replay: set same `SESSION_ID`, provide same `handId` and `GameState`.
6. Trigger SafeMode via CLI/config, replay the same hand, and confirm the logged `rngSeed` + `modelVersions` match the healthy run even though SafeAction is returned.

---

### 5. Documentation & Examples

#### 5.1 Update Design Document

**File**: `design.md`

Update "Reproducibility" section:

- Document standardized seed generation: `hash(handId + sessionId)`.
- Document model version tracking in HandRecord metadata.
- Add example HandRecord with modelVersions.

#### 5.2 Create Replay Guide

**File**: `docs/replay.md` (new, optional)

Document replay process:

- How to extract seed from HandRecord.
- How to set `SESSION_ID` and `handId` for replay.
- How to verify model versions match.
- Example replay script.

#### 5.3 Update Task Checklist

**File**: `task12_check.md` (new)

Acceptance checklist:

- [ ] RNG seed generated from `hash(handId + sessionId)`.
- [ ] Config override (`strategy.rngSeed`) takes precedence.
- [ ] LLM model versions collected and logged.
- [ ] Vision model versions collected and logged.
- [ ] GTO cache version collected and logged.
- [ ] Model versions included in HandRecord.metadata.
- [ ] RNG seed included in HandRecord.metadata.
- [ ] Unit tests pass for seed generation.
- [ ] Integration tests pass for replay determinism.
- [ ] Manual replay verification succeeds.

---

## Definition of Done

1. **RNG Seed Standardization**:

            - `generateRngSeed(handId, sessionId)` function in `@poker-bot/shared`.
            - `ActionSelector` uses standardized seed generation.
            - All randomness (action selection, timing jitter) uses seeded RNG.
            - RNG seed logged in HandRecord metadata.

2. **Model Version Tracking**:

            - `ModelVersions` interface defined in `@poker-bot/shared`.
            - `ModelVersionCollector` collects LLM, vision, and GTO cache versions.
            - Model versions included in `HandRecord.metadata.modelVersions`.
            - Collection is cached (low overhead per hand).

3. **Integration**:

            - Orchestrator collects model versions at hand start.
            - Model versions passed to `buildHandRecord`.
            - RNG seed extracted from decision metadata and logged.

4. **Testing**:

            - Unit tests for seed generation determinism.
            - Integration tests for replay determinism.
            - Model version collection tests.

5. **Documentation**:

            - `task12_check.md` acceptance checklist.
            - `design.md` updated with reproducibility details.

Once these deliverables are met and merged, Task 12 is ready for review, enabling deterministic replay and full reproducibility for downstream analysis and debugging.
