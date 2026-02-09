# CoinPoker Autonomy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable autonomous CoinPoker cash-game play on macOS by completing vision assets, OS automation, and a continuous decision loop.

**Architecture:** Add macOS OS-automation (nut.js + AppleScript) to the executor and wire it to live vision output; add CoinPoker layout packs and template assets for the vision service; introduce a game loop CLI that polls vision, feeds the decision pipeline, and executes actions with safety gates. Keep the existing orchestrator/agents/solver behavior unchanged.

**Tech Stack:** TypeScript (pnpm, vitest), Python 3.11 (Poetry, OpenCV), gRPC, @nut-tree/nut-js, AppleScript (osascript).

---

## Inputs Needed
- Target CoinPoker table resolution and macOS scaling (example: 2560x1440 @ 2x).
- Table type to support first (6-max vs heads-up).
- CoinPoker macOS process name and example window title.
- Decide whether template-matching MVP is acceptable before ONNX models.

---

### Task 1: Extend Research UI Config for Window + Bet Input

**Files:**
- Modify: `packages/executor/src/types.ts`
- Modify: `packages/executor/src/index.ts`
- Modify: `config/schema/bot-config.schema.json`
- Create: `packages/executor/test/executor_config.spec.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { createActionExecutor } from "../src";

vi.mock("../src/window_manager", () => {
  return {
    WindowManager: vi.fn().mockImplementation(() => ({
      findPokerWindow: vi.fn(),
      getWindowBounds: vi.fn(),
      validateWindow: vi.fn(),
      focusWindow: vi.fn(),
      buttonToScreenCoords: vi.fn()
    }))
  };
});

vi.mock("../src/compliance", () => {
  return { ComplianceChecker: vi.fn().mockImplementation(() => ({ validateExecution: vi.fn() })) };
});

vi.mock("../src/research_bridge", () => {
  return { ResearchUIExecutor: vi.fn() };
});

import { WindowManager } from "../src/window_manager";

describe("createActionExecutor research-ui config", () => {
  it("passes windowTitlePatterns/processNames/minWindowSize into WindowManager", () => {
    createActionExecutor("research-ui", {
      enabled: true,
      mode: "research-ui",
      verifyActions: false,
      maxRetries: 0,
      verificationTimeoutMs: 1000,
      researchUI: {
        allowlist: ["coinpoker"],
        prohibitedSites: [],
        requireBuildFlag: true,
        windowTitlePatterns: ["CoinPoker"],
        processNames: ["CoinPoker"],
        minWindowSize: { width: 1200, height: 700 }
      }
    });

    expect(WindowManager).toHaveBeenCalledWith(
      expect.objectContaining({
        titlePatterns: ["CoinPoker"],
        processNames: ["CoinPoker"],
        minWindowSize: { width: 1200, height: 700 }
      }),
      expect.anything()
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @poker-bot/executor test -- executor_config.spec.ts`
Expected: FAIL with missing fields or constructor args not matching.

**Step 3: Write minimal implementation**

```ts
interface BetInputConfig extends InputField {
  decimalPrecision: number;
  decimalSeparator: "." | ",";
}

export interface ResearchUIConfig extends ComplianceConfig {
  windowTitlePatterns?: string[];
  processNames?: string[];
  minWindowSize?: { width: number; height: number };
  betInputField?: BetInputConfig;
  minRaiseAmount?: number;
}

export interface ExecutorConfig {
  enabled: boolean;
  mode: ExecutionMode;
  verifyActions: boolean;
  maxRetries: number;
  verificationTimeoutMs: number;
  simulatorEndpoint?: string;
  researchUI?: ResearchUIConfig;
}
```

```ts
const windowConfig: WindowConfig = {
  titlePatterns:
    config.researchUI.windowTitlePatterns ?? config.researchUI.allowlist ?? [],
  processNames: config.researchUI.processNames ?? [],
  minWindowSize: config.researchUI.minWindowSize ?? { width: 800, height: 600 }
};
```

Update `config/schema/bot-config.schema.json` under `execution.researchUI`:

```json
"windowTitlePatterns": {
  "type": "array",
  "items": { "type": "string", "minLength": 1 },
  "default": []
},
"processNames": {
  "type": "array",
  "items": { "type": "string", "minLength": 1 },
  "default": []
},
"minWindowSize": {
  "type": "object",
  "additionalProperties": false,
  "required": ["width", "height"],
  "properties": {
    "width": { "type": "number", "exclusiveMinimum": 0 },
    "height": { "type": "number", "exclusiveMinimum": 0 }
  }
},
"betInputField": {
  "type": "object",
  "additionalProperties": false,
  "required": ["x", "y", "width", "height", "decimalPrecision", "decimalSeparator"],
  "properties": {
    "x": { "type": "number" },
    "y": { "type": "number" },
    "width": { "type": "number", "exclusiveMinimum": 0 },
    "height": { "type": "number", "exclusiveMinimum": 0 },
    "decimalPrecision": { "type": "integer", "minimum": 0 },
    "decimalSeparator": { "type": "string", "enum": [".", ","] }
  }
},
"minRaiseAmount": {
  "type": "number",
  "exclusiveMinimum": 0
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @poker-bot/executor test -- executor_config.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/executor/src/types.ts packages/executor/src/index.ts config/schema/bot-config.schema.json packages/executor/test/executor_config.spec.ts
git commit -m "feat(executor): extend research-ui config"
```

---

### Task 2: Implement macOS WindowManager + Compliance Process Checks

**Files:**
- Modify: `packages/executor/src/window_manager.ts`
- Modify: `packages/executor/src/compliance.ts`
- Create: `packages/executor/test/window_manager.spec.ts`
- Create: `packages/executor/test/compliance.spec.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { WindowManager } from "../src/window_manager";

const mockRunner = async () =>
  [
    "CoinPoker||CoinPoker Table 1||100||200||1280||720",
    "Notes||Notes||10||10||400||300"
  ].join("\n");

describe("WindowManager macOS parsing", () => {
  it("returns first matching window", async () => {
    const manager = new WindowManager(
      {
        titlePatterns: ["CoinPoker"],
        processNames: ["CoinPoker"],
        minWindowSize: { width: 800, height: 600 }
      },
      console,
      mockRunner
    );

    const window = await manager.findPokerWindow();
    expect(window).toEqual(
      expect.objectContaining({ title: "CoinPoker Table 1", processName: "CoinPoker" })
    );
  });
});
```

```ts
import { describe, it, expect } from "vitest";
import { ComplianceChecker } from "../src/compliance";

const processList = async () => ["CoinPoker", "Safari", "Chrome"];

describe("ComplianceChecker", () => {
  it("flags non-allowlisted processes", async () => {
    const checker = new ComplianceChecker(
      { allowlist: ["coinpoker"], prohibitedSites: [], requireBuildFlag: false },
      console,
      processList
    );

    const result = await checker.checkEnvironment();
    expect(result.allowed).toBe(false);
    expect(result.violations.join(" ")).toContain("Safari");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @poker-bot/executor test -- window_manager.spec.ts compliance.spec.ts`
Expected: FAIL due to missing constructor args and logic.

**Step 3: Write minimal implementation**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type AppleScriptRunner = (script: string) => Promise<string>;

const defaultRunner: AppleScriptRunner = async (script) => {
  const { stdout } = await execFileAsync("osascript", ["-e", script]);
  return stdout.trim();
};
```

```ts
constructor(
  config: WindowConfig,
  logger: Pick<Console, "debug" | "info" | "warn" | "error"> = console,
  appleScriptRunner: AppleScriptRunner = defaultRunner
) {
  this.config = config;
  this.logger = logger;
  this.appleScriptRunner = appleScriptRunner;
}
```

```ts
private parseWindowList(output: string): WindowHandle[] {
  if (!output) return [];
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [processName, title, x, y, width, height] = line.split("||");
      return {
        id: `${processName}:${title}`,
        processName,
        title,
        bounds: {
          x: Number(x),
          y: Number(y),
          width: Number(width),
          height: Number(height)
        }
      } as WindowHandle & { bounds: WindowBounds };
    });
}
```

```ts
async findPokerWindow(): Promise<WindowHandle | null> {
  const script = `
    tell application "System Events"
      set output to ""
      repeat with proc in (processes whose background only is false)
        set procName to name of proc
        repeat with win in windows of proc
          set winTitle to name of win
          set {x, y} to position of win
          set {w, h} to size of win
          set output to output & procName & "||" & winTitle & "||" & x & "||" & y & "||" & w & "||" & h & linefeed
        end repeat
      end repeat
      return output
    end tell
  `;

  const output = await this.appleScriptRunner(script);
  const windows = this.parseWindowList(output);

  const titleMatchers = this.config.titlePatterns.map((pattern) => new RegExp(pattern, "i"));
  const processMatchers = this.config.processNames.map((pattern) => new RegExp(pattern, "i"));

  const match = windows.find((win) => {
    const titleOk = titleMatchers.length === 0 || titleMatchers.some((rx) => rx.test(win.title));
    const processOk = processMatchers.length === 0 || processMatchers.some((rx) => rx.test(win.processName));
    const bounds = (win as any).bounds as WindowBounds;
    return titleOk && processOk && bounds.width >= this.config.minWindowSize.width && bounds.height >= this.config.minWindowSize.height;
  });

  return match ?? null;
}
```

```ts
async focusWindow(handle: WindowHandle): Promise<boolean> {
  const script = `
    tell application "System Events"
      tell process "${handle.processName}"
        set frontmost to true
      end tell
    end tell
  `;
  await this.appleScriptRunner(script);
  return true;
}

async getWindowBounds(handle: WindowHandle): Promise<WindowBounds> {
  const script = `
    tell application "System Events"
      tell process "${handle.processName}"
        set win to first window whose name is "${handle.title}"
        set {x, y} to position of win
        set {w, h} to size of win
        return x & "||" & y & "||" & w & "||" & h
      end tell
    end tell
  `;
  const output = await this.appleScriptRunner(script);
  const [x, y, width, height] = output.split("||").map(Number);
  return { x, y, width, height };
}
```

```ts
constructor(
  config: ComplianceConfig,
  logger: Pick<Console, "debug" | "info" | "warn" | "error"> = console,
  processListProvider: () => Promise<string[]> = defaultProcessList
) {
  this.config = config;
  this.logger = logger;
  this.processListProvider = processListProvider;
}
```

```ts
const defaultProcessList = async (): Promise<string[]> => {
  if (process.platform !== "darwin") return [];
  const { stdout } = await execFileAsync("ps", ["-A", "-o", "comm="]);
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
};
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @poker-bot/executor test -- window_manager.spec.ts compliance.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/executor/src/window_manager.ts packages/executor/src/compliance.ts packages/executor/test/window_manager.spec.ts packages/executor/test/compliance.spec.ts
git commit -m "feat(executor): add macOS window + compliance checks"
```

---

### Task 3: Integrate nut.js Mouse/Keyboard + Bet Input

**Files:**
- Modify: `packages/executor/package.json`
- Modify: `packages/executor/src/research_bridge.ts`
- Modify: `packages/executor/src/bet_input_handler.ts`
- Create: `packages/executor/test/bet_input_handler.spec.ts`
- Modify: `packages/executor/test/research_bridge.spec.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { BetInputHandler } from "../src/bet_input_handler";

vi.mock("@nut-tree/nut-js", () => {
  return {
    mouse: { move: vi.fn(), leftClick: vi.fn() },
    keyboard: { type: vi.fn(), pressKey: vi.fn(), releaseKey: vi.fn() },
    straightTo: vi.fn((point) => point),
    Point: class {
      constructor(public x: number, public y: number) {}
    },
    Key: { LeftCmd: "LeftCmd", LeftControl: "LeftControl", A: "A", Backspace: "Backspace" }
  };
});

const handler = new BetInputHandler(console, { x: 10, y: 20, width: 100, height: 30 });

describe("BetInputHandler", () => {
  it("types the raise amount using nut.js", async () => {
    await handler.inputBetAmount(
      { type: "raise", amount: 12.5, position: "BTN", street: "flop" },
      { id: "1", title: "CoinPoker Table", processName: "CoinPoker" }
    );

    const { keyboard } = await import("@nut-tree/nut-js");
    expect(keyboard.type).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @poker-bot/executor test -- bet_input_handler.spec.ts`
Expected: FAIL due to missing nut.js integration and new constructor signature.

**Step 3: Write minimal implementation**

Add dependency:

```json
"dependencies": {
  "@poker-bot/shared": "workspace:*",
  "@nut-tree/nut-js": "^4.2.0"
}
```

Update constructor + input field usage:

```ts
export class BetInputHandler {
  private readonly inputField?: InputField;

  constructor(
    logger: Pick<Console, "debug" | "info" | "warn" | "error"> = console,
    inputField?: InputField
  ) {
    this.logger = logger;
    this.inputField = inputField;
  }

  private async locateBetInputField(): Promise<InputField | null> {
    return this.inputField ?? null;
  }
}
```

Add nut.js usage:

```ts
import { mouse, keyboard, Point, Key, straightTo } from "@nut-tree/nut-js";

private async clearInputField(inputField: InputField): Promise<void> {
  await mouse.move(straightTo(new Point(inputField.x + 5, inputField.y + 5)));
  await mouse.leftClick();
  const metaKey = process.platform === "darwin" ? Key.LeftCmd : Key.LeftControl;
  await keyboard.pressKey(metaKey, Key.A);
  await keyboard.releaseKey(metaKey, Key.A);
  await keyboard.pressKey(Key.Backspace);
  await keyboard.releaseKey(Key.Backspace);
}

private async typeCharacter(char: string): Promise<void> {
  await keyboard.type(char);
}
```

Update `ResearchUIExecutor` mouse actions:

```ts
import { mouse, Point, straightTo } from "@nut-tree/nut-js";

private async moveMouse(x: number, y: number): Promise<void> {
  await mouse.move(straightTo(new Point(x, y)));
}

private async clickMouse(): Promise<void> {
  await mouse.leftClick();
}
```

Update `ResearchUIExecutor` to construct `BetInputHandler` with config-provided input field when available.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @poker-bot/executor test -- bet_input_handler.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/executor/package.json packages/executor/src/bet_input_handler.ts packages/executor/src/research_bridge.ts packages/executor/test/bet_input_handler.spec.ts packages/executor/test/research_bridge.spec.ts
git commit -m "feat(executor): wire nut.js mouse/keyboard"
```

---

### Task 4: Wire Vision Output Into ResearchUIExecutor

**Files:**
- Modify: `packages/executor/src/types.ts`
- Modify: `packages/executor/src/research_bridge.ts`
- Modify: `packages/executor/src/index.ts`
- Modify: `packages/orchestrator/src/main.ts`
- Modify: `packages/executor/test/research_bridge.spec.ts`

**Step 1: Write the failing test**

```ts
it("uses vision output to gate turn and select button", async () => {
  const visionClient = {
    captureAndParse: vi.fn().mockResolvedValue({
      actionButtons: {
        raise: { screenCoords: { x: 10, y: 20 }, isEnabled: true, isVisible: true, confidence: 0.9 }
      },
      turnState: { isHeroTurn: true, confidence: 0.9 },
      cards: { holeCards: [], communityCards: [], confidence: 1 },
      stacks: new Map(),
      pot: { amount: 0, confidence: 1 },
      buttons: { dealer: "BTN", confidence: 1 },
      positions: { confidence: 1 },
      occlusion: new Map(),
      latency: { capture: 0, extraction: 0, total: 0 }
    })
  };

  const executor = new ResearchUIExecutor(
    mockWindowManager as WindowManager,
    mockComplianceChecker as ComplianceChecker,
    undefined,
    console,
    visionClient
  );

  vi.spyOn(executor as any, "delay").mockResolvedValue(undefined);
  vi.spyOn(executor as any, "performAction").mockResolvedValue({ success: true, actionExecuted: baseDecision.action });

  const result = await executor.execute(baseDecision, { verifyAction: false });
  expect(visionClient.captureAndParse).toHaveBeenCalled();
  expect(result.success).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @poker-bot/executor test -- research_bridge.spec.ts`
Expected: FAIL because ResearchUIExecutor does not accept/use vision client.

**Step 3: Write minimal implementation**

```ts
import type { VisionOutput } from "@poker-bot/shared";

export interface ResearchVisionClient {
  captureAndParse(): Promise<VisionOutput>;
}
```

```ts
constructor(
  windowManager: WindowManager,
  complianceChecker: ComplianceChecker,
  verifier?: ActionVerifier,
  logger: Pick<Console, "debug" | "info" | "warn" | "error"> = console,
  visionClient?: ResearchVisionClient
) {
  this.windowManager = windowManager;
  this.complianceChecker = complianceChecker;
  this.betInputHandler = new BetInputHandler(logger, windowManager.getBetInputField?.());
  this.verifier = verifier;
  this.logger = logger;
  this.visionClient = visionClient;
}
```

```ts
private async captureVisionOutput(): Promise<VisionOutput> {
  if (!this.visionClient) {
    throw new Error("Vision client not configured for research-ui execution");
  }
  return this.visionClient.captureAndParse();
}
```

```ts
const visionOutput = await this.captureVisionOutput();
const turnState = visionOutput.turnState;
if (!turnState?.isHeroTurn) {
  const error = "Not hero's turn";
  this.logger.warn("ResearchUIExecutor: " + error);
  return this.createFailureResult(error, startTime);
}

const actionButton = this.windowManager.findActionButton(visionOutput, decision.action.type);
if (!actionButton) {
  const error = `Action button ${decision.action.type} not found or not actionable`;
  this.logger.error("ResearchUIExecutor: " + error);
  return this.createFailureResult(error, startTime);
}
```

Update `createActionExecutor` signature to accept a `visionClient` override, and in `packages/orchestrator/src/main.ts` pass the same `executionVisionClient` used by the verifier into `createActionExecutor`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @poker-bot/executor test -- research_bridge.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/executor/src/types.ts packages/executor/src/research_bridge.ts packages/executor/src/index.ts packages/orchestrator/src/main.ts packages/executor/test/research_bridge.spec.ts
git commit -m "feat(executor): use vision output for live execution"
```

---

### Task 5: Vision Templates + Turn-State Detection

**Files:**
- Create: `services/vision/src/vision/templates.py`
- Modify: `services/vision/src/vision/server.py`
- Modify: `services/vision/pyproject.toml`
- Create: `services/vision/tests/test_templates.py`
- Create: `services/vision/tests/test_turn_state.py`

**Step 1: Write the failing tests**

```py
import os
import cv2
import numpy as np
from vision.templates import load_button_templates

def test_load_button_templates_resolves_relative_paths(tmp_path):
  assets = tmp_path / "assets"
  assets.mkdir()
  (assets / "buttons").mkdir()
  image = np.zeros((10, 10, 3), dtype=np.uint8)
  path = assets / "buttons" / "fold.png"
  cv2.imwrite(str(path), image)

  layout = {"buttonTemplates": {"fold": "buttons/fold.png"}}
  templates = load_button_templates(layout, str(assets))
  assert "fold" in templates
```

```py
from vision.server import derive_turn_state

def test_derive_turn_state_from_buttons():
  buttons = {
    "fold": {"is_visible": True, "is_enabled": True, "confidence": 0.9},
    "call": {"is_visible": False, "is_enabled": False, "confidence": 0.1}
  }
  state = derive_turn_state(buttons)
  assert state["is_hero_turn"] is True
```

**Step 2: Run test to verify it fails**

Run: `cd services/vision && poetry run pytest`
Expected: FAIL due to missing loader and turn-state helper.

**Step 3: Write minimal implementation**

```py
import os
from typing import Dict
import cv2
import numpy as np


def resolve_template_path(path: str, asset_root: str) -> str:
  return path if os.path.isabs(path) else os.path.join(asset_root, path)


def load_button_templates(layout: dict, asset_root: str) -> Dict[str, np.ndarray]:
  templates: Dict[str, np.ndarray] = {}
  for name, rel in (layout.get("buttonTemplates") or {}).items():
    path = resolve_template_path(rel, asset_root)
    image = cv2.imread(path)
    if image is not None:
      templates[name] = image
  return templates
```

```py
def derive_turn_state(buttons: Dict[str, Dict[str, object]]) -> Dict[str, object]:
  best_conf = 0.0
  is_turn = False
  for info in buttons.values():
    visible = bool(info.get("is_visible"))
    enabled = bool(info.get("is_enabled"))
    confidence = float(info.get("confidence", 0.0))
    if visible and enabled:
      is_turn = True
      best_conf = max(best_conf, confidence)
  return {"is_hero_turn": is_turn, "confidence": best_conf}
```

Wire into `VisionServicer`:

```py
asset_root = os.environ.get("VISION_ASSET_DIR", "assets")
button_templates = load_button_templates(layout, asset_root)

# inside _process_action_buttons
for raw_name, region in buttons.items():
  template = button_templates.get(raw_name)
  template_conf = match_template(region["image"], template) if template is not None else 0.0
  _, occlusion_score = detect_occlusion(region["image"], region["roi"])
  confidence = max(template_conf, 1.0 - occlusion_score)
  button_info = {
    "screen_coords": (int(round(float(region["roi"]["x"]))), int(round(float(region["roi"]["y"])))),
    "is_enabled": occlusion_score < 0.5,
    "is_visible": confidence >= 0.6,
    "confidence": confidence,
    "text": raw_name
  }
  builder.set_action_button(proto_name, button_info)

turn_state = derive_turn_state(builder_action_buttons)
builder.set_turn_state(turn_state["is_hero_turn"], None, turn_state["confidence"])
```

Add `pytesseract` dependency:

```toml
pytesseract = "^0.3.10"
```

**Step 4: Run tests to verify they pass**

Run: `cd services/vision && poetry run pytest`
Expected: PASS

**Step 5: Commit**

```bash
git add services/vision/src/vision/templates.py services/vision/src/vision/server.py services/vision/pyproject.toml services/vision/tests/test_templates.py services/vision/tests/test_turn_state.py
git commit -m "feat(vision): load templates + derive turn state"
```

---

### Task 6: CoinPoker Layout Pack + Template Assets + Bot Config

**Files:**
- Create: `config/layout-packs/coinpoker/default.layout.json`
- Create: `config/bot/coinpoker.bot.json`
- Create: `services/vision/assets/templates/coinpoker/buttons/*.png`
- Create: `services/vision/assets/templates/coinpoker/cards/*.png`
- Create: `services/vision/assets/templates/coinpoker/dealer.png`

**Step 1: Capture the target CoinPoker table**

- Take a full-window screenshot of a CoinPoker cash table at the target resolution.
- Record the window title and process name from Activity Monitor.

**Step 2: Measure ROIs and update the layout JSON**

Create `config/layout-packs/coinpoker/default.layout.json` using measured pixel values. Example shape:

```json
{
  "version": "1.0.0",
  "platform": "coinpoker",
  "theme": "default",
  "resolution": { "width": 2560, "height": 1440 },
  "dpiCalibration": 2.0,
  "cardROIs": [
    { "x": 0, "y": 0, "width": 0, "height": 0 }
  ],
  "stackROIs": {
    "BTN": { "x": 0, "y": 0, "width": 0, "height": 0 },
    "SB": { "x": 0, "y": 0, "width": 0, "height": 0 },
    "BB": { "x": 0, "y": 0, "width": 0, "height": 0 },
    "UTG": { "x": 0, "y": 0, "width": 0, "height": 0 },
    "MP": { "x": 0, "y": 0, "width": 0, "height": 0 },
    "CO": { "x": 0, "y": 0, "width": 0, "height": 0 }
  },
  "potROI": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "buttonROI": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "actionButtonROIs": {
    "fold": { "x": 0, "y": 0, "width": 0, "height": 0 },
    "check": { "x": 0, "y": 0, "width": 0, "height": 0 },
    "call": { "x": 0, "y": 0, "width": 0, "height": 0 },
    "raise": { "x": 0, "y": 0, "width": 0, "height": 0 },
    "bet": { "x": 0, "y": 0, "width": 0, "height": 0 },
    "allIn": { "x": 0, "y": 0, "width": 0, "height": 0 }
  },
  "turnIndicatorROI": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "windowPatterns": {
    "titleRegex": "^CoinPoker.*Table",
    "processName": "CoinPoker"
  },
  "buttonTemplates": {
    "fold": "templates/coinpoker/buttons/fold.png",
    "check": "templates/coinpoker/buttons/check.png",
    "call": "templates/coinpoker/buttons/call.png",
    "raise": "templates/coinpoker/buttons/raise.png",
    "allIn": "templates/coinpoker/buttons/allin.png"
  }
}
```

**Step 3: Capture template assets**

- Crop button images into `services/vision/assets/templates/coinpoker/buttons/`.
- Crop card faces into `services/vision/assets/templates/coinpoker/cards/` using naming like `Ah.png`, `Td.png`, etc.
- Capture dealer button into `services/vision/assets/templates/coinpoker/dealer.png`.

**Step 4: Create a CoinPoker bot config**

Create `config/bot/coinpoker.bot.json` (copy `config/bot/default.bot.json`) and update:

```json
"vision": { "layoutPack": "coinpoker/default", "dpiCalibration": 2.0, "confidenceThreshold": 0.9, "occlusionThreshold": 0.05 },
  "execution": {
  "enabled": true,
  "mode": "research-ui",
  "verifyActions": true,
  "maxRetries": 1,
  "verificationTimeoutMs": 2000,
    "researchUI": {
      "allowlist": ["coinpoker"],
      "prohibitedSites": ["bet365", "williamhill"],
      "requireBuildFlag": true,
      "windowTitlePatterns": ["CoinPoker"],
      "processNames": ["CoinPoker"],
      "minWindowSize": { "width": 1200, "height": 700 },
      "betInputField": {
        "x": 0,
        "y": 0,
        "width": 0,
        "height": 0,
        "decimalPrecision": 2,
        "decimalSeparator": "."
      },
      "minRaiseAmount": 2
    }
  }
```

**Step 5: Commit**

```bash
git add config/layout-packs/coinpoker/default.layout.json config/bot/coinpoker.bot.json services/vision/assets/templates/coinpoker
git commit -m "feat(config): add CoinPoker layout + assets"
```

---

### Task 7: Add Game Loop + CLI Runner

**Files:**
- Create: `packages/orchestrator/src/game-loop.ts`
- Create: `packages/orchestrator/src/cli/live.ts`
- Modify: `packages/orchestrator/src/index.ts`
- Modify: `packages/orchestrator/package.json`
- Create: `packages/orchestrator/test/decision/game-loop.spec.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { GameLoop } from "../../src/game-loop";

const visionClient = {
  captureAndParse: vi.fn()
};

const parser = { parse: vi.fn() };
const makeDecision = vi.fn();

it("executes once when hero turn is detected", async () => {
  visionClient.captureAndParse
    .mockResolvedValueOnce({ turnState: { isHeroTurn: false, confidence: 0.9 } })
    .mockResolvedValueOnce({ turnState: { isHeroTurn: true, confidence: 0.9 } });

  parser.parse.mockReturnValue({ handId: "h1", street: "flop", actionHistory: [] });

  const loop = new GameLoop({ visionClient, parser, makeDecision, pollIntervalMs: 10 });
  const run = loop.start();
  await new Promise((r) => setTimeout(r, 50));
  loop.stop();
  await run;

  expect(makeDecision).toHaveBeenCalledTimes(1);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @poker-bot/orchestrator exec vitest run packages/orchestrator/test/decision/game-loop.spec.ts`
Expected: FAIL due to missing GameLoop.

**Step 3: Write minimal implementation**

```ts
import type { VisionOutput } from "@poker-bot/shared";
import type { GameState } from "@poker-bot/shared";

interface GameLoopDeps {
  visionClient: { captureAndParse: () => Promise<VisionOutput> };
  parser: { parse: (output: VisionOutput) => GameState };
  makeDecision: (state: GameState) => Promise<unknown>;
  pollIntervalMs?: number;
  logger?: Pick<Console, "debug" | "info" | "warn" | "error">;
}

export class GameLoop {
  private stopped = false;
  private lastFingerprint: string | null = null;
  private readonly pollIntervalMs: number;
  private readonly logger: Pick<Console, "debug" | "info" | "warn" | "error">;

  constructor(private readonly deps: GameLoopDeps) {
    this.pollIntervalMs = deps.pollIntervalMs ?? 100;
    this.logger = deps.logger ?? console;
  }

  async start(): Promise<void> {
    while (!this.stopped) {
      try {
        const output = await this.deps.visionClient.captureAndParse();
        if (!output.turnState?.isHeroTurn) {
          await this.sleep(this.pollIntervalMs);
          continue;
        }
        const state = this.deps.parser.parse(output);
        const fingerprint = `${state.handId}:${state.street}:${state.actionHistory?.length ?? 0}`;
        if (fingerprint === this.lastFingerprint) {
          await this.sleep(this.pollIntervalMs);
          continue;
        }
        this.lastFingerprint = fingerprint;
        await this.deps.makeDecision(state);
      } catch (error) {
        this.logger.warn("GameLoop: error during loop", error);
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  stop(): void {
    this.stopped = true;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

Add CLI `packages/orchestrator/src/cli/live.ts`:

```ts
import { run } from "../main";
import { GameLoop } from "../game-loop";
import { VisionClient } from "../vision/client";
import { GameStateParser } from "../vision/parser";
import { vision } from "@poker-bot/shared";
import path from "node:path";

async function main() {
  const orchestrator = await run();
  const layoutPath = process.env.BOT_LAYOUT_PATH || orchestrator.vision.layoutPath;
  const layout = vision.loadLayoutPack(path.resolve(layoutPath));

  const visionClient = new VisionClient(
    process.env.VISION_SERVICE_URL ?? "0.0.0.0:50052",
    layout
  );

  const parser = new GameStateParser(orchestrator.vision.parserConfig);

  const loop = new GameLoop({
    visionClient,
    parser,
    makeDecision: (state) => orchestrator.strategy.makeDecision(state)
  });

  await loop.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Update `packages/orchestrator/package.json`:

```json
"live": "tsx src/cli/live.ts"
```

Update `packages/orchestrator/src/index.ts`:

```ts
export * from "./game-loop";
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @poker-bot/orchestrator exec vitest run packages/orchestrator/test/decision/game-loop.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/orchestrator/src/game-loop.ts packages/orchestrator/src/cli/live.ts packages/orchestrator/src/index.ts packages/orchestrator/package.json packages/orchestrator/test/decision/game-loop.spec.ts
git commit -m "feat(orchestrator): add live game loop"
```

---

### Task 8: Update Operator Docs for Live CoinPoker Run

**Files:**
- Modify: `docs/operator_manual.md`
- Modify: `docs/env.md`

**Step 1: Update operator manual**

Add a new section with exact commands:

```md
## Live CoinPoker Run (macOS)

1. Start solver:
   `cd services/solver && cargo run --release`
2. Start vision:
   `cd services/vision && VISION_ASSET_DIR=assets VISION_MODEL_DIR=models poetry run python -m vision.server`
3. Start orchestrator loop:
   `RESEARCH_UI_ENABLED=true BOT_CONFIG=config/bot/coinpoker.bot.json pnpm --filter @poker-bot/orchestrator run live`
```

**Step 2: Update env docs**

Document `VISION_ASSET_DIR`, `VISION_MODEL_DIR`, `VISION_SERVICE_URL`, `RESEARCH_UI_ENABLED`, and `BOT_CONFIG`.

**Step 3: Commit**

```bash
git add docs/operator_manual.md docs/env.md
git commit -m "docs: add live CoinPoker runbook"
```

---

## Optional Accuracy Phase: ONNX Models

If template matching is insufficient, add training scripts under `services/vision/tools/` to generate `card_rank.onnx`, `card_suit.onnx`, and `digit.onnx`, then place them in `services/vision/models/`. Validate by running `services/vision` with `VISION_MODEL_DIR=models` and confirming confidence thresholds on 100+ hands.
