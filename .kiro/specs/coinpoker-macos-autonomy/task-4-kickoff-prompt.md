# Task 4 Kickoff Prompt (Patched)

You are implementing **Task 4 (4.1–4.8)** end-to-end for CoinPoker macOS autonomy.

## 1) Repo and branch
- **Repo:** `/Users/jonahgrigoryan/gittest`
- **Branch:** `feat/task-4-nutjs-input-automation`
- **Base branch gate:** Start from latest `main` after Task 3 is merged and CI-green. Verify with `git fetch origin && git log HEAD..origin/main --oneline` — should be empty if based on latest main.
- **Scope gate:** Tasks 0, 1, 2, and 3 are already complete/merged. Do not implement Task 5+. Specifically, do NOT implement vision turn-state integration (Task 7) — keep `getCurrentTurnState()` and `findActionButton()` behavior in `research_bridge.ts` unchanged unless required for Task 4 tests.

## 2) Read first (source of truth)
- `/Users/jonahgrigoryan/gittest/.kiro/specs/coinpoker-macos-autonomy/requirements.md`
- `/Users/jonahgrigoryan/gittest/.kiro/specs/coinpoker-macos-autonomy/design.md`
- `/Users/jonahgrigoryan/gittest/.kiro/specs/coinpoker-macos-autonomy/tasks.md`

Focus on:
- Requirements 3.1–3.11 (mouse/keyboard automation, bet formatting)
- Requirements 12.1–12.5 (coordinate scaling and translation)
- Properties 9, 10, 11, 12, 31, 32
- Task items 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8

## 3) Current code baseline to replace
- **`packages/executor/src/research_bridge.ts`**: `moveMouse()` and `clickMouse()` are stubs (no real OS automation).
- **`packages/executor/src/bet_input_handler.ts`**: `typeCharacter()`, `clearInputField()` are stubs; `locateBetInputField()` has config fallback; `verifyTypedAmount()` is a stub — keep as placeholder unless spec requires verification.
- **`packages/executor/src/window_manager.ts`**: Existing `roiToScreenCoords()` and `buttonToScreenCoords()` handle basic coordinate translation but do NOT handle proportional scaling for window size != layout resolution.

Keep existing public behavior/signatures used by executor:
- `ResearchUIExecutor.execute()`, `performAction()`, constructor
- `BetInputHandler.inputBetAmount()`, constructor (config, logger)
- `WindowManager.roiToScreenCoords()`, `buttonToScreenCoords()`, `getWindowBounds()`, `validateWindow()`

## 4) Required implementation

### 4.1 Create InputAutomation class wrapping nut.js
Create: `/Users/jonahgrigoryan/gittest/packages/executor/src/input_automation.ts`

**Dependencies:**
- Add `@nut-tree/nut-js` as a dependency in `packages/executor/package.json`.

**Interface:**
```typescript
interface CoordinateContext {
  dpiCalibration: number;
  layoutResolution: { width: number; height: number };
  windowBounds: { x: number; y: number; width: number; height: number };
}
export class InputAutomation {
  constructor(
    private coordinateContext: CoordinateContext,
    private logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> = console
  ) {}
  async clickAt(visionX: number, visionY: number): Promise<void> {...}
  async typeText(text: string): Promise<void> {...}
  async clearTextField(): Promise<void> {...}
  updateCoordinateContext(context: CoordinateContext): void {...}
}
```

**Requirements:**
1. **Click implementation:** Use `mouse.move(straightTo(point))` then `mouse.leftClick()` — do NOT use `setPosition`. Per Req 3.8.
2. **TypeText implementation:** Use `keyboard.type(text)`.
3. **ClearTextField implementation:** Use key combination: `keyboard.pressKey(Key.LeftCmd, Key.A)` then `keyboard.releaseKey(Key.LeftCmd, Key.A)` then `keyboard.pressKey(Key.Backspace)` (macOS — use `Key.LeftCmd`, not `Key.LeftCommand`).
4. **Coordinate translation (CRITICAL):** Single translation path. InputAutomation MUST call `WindowManager.visionToScreenCoords()` for coordinates — do NOT duplicate the formula in InputAutomation. See §4.4 for the method to add.
5. **Human-like pre-action delay:** Add 1–3 second delay before clicking, using `deterministicRandom` from `packages/executor/src/rng.ts` (Req 3.10).
6. **Out-of-bounds rejection (Req 12.4):** When translated screen coords fall outside `[windowBounds.x, windowBounds.x + windowBounds.width]` and `[windowBounds.y, windowBounds.y + windowBounds.height]`, abort click, log error with descriptive message, and throw.
7. **Injectable for tests:** Design for dependency injection. Create `MouseKeyboardProvider` interface so tests can mock nut.js calls. No real mouse/keyboard in CI.
8. **DPI:** Align with design doc. If `WindowManager.detectDPIScale()` or existing code already applies system DPI, do not double-apply in InputAutomation.
9. **Configured movement speed (Req 3.8):** Set nut.js mouse movement speed from a configurable InputAutomation option (with a sane default) before movement. Do not hardcode opaque magic numbers.
10. **Single translation dependency:** Inject a translator dependency (`WindowManager` instance or callback) and route coordinate translation through `visionToScreenCoords()` only. InputAutomation must not duplicate the translation math.

### 4.2 Extend BetInputHandler with nut.js integration
File: `/Users/jonahgrigoryan/gittest/packages/executor/src/bet_input_handler.ts`

**Existing code to keep (already implemented):**
- `formatAmount()` — formats with decimal precision and separator
- `validateBetAmount()` — checks minRaiseAmount and decimal precision
- `getDecimalPlaces()` — helper for precision checking

**Stubs to replace:**
- `clearInputField()` — replace with InputAutomation calls (Cmd+A + Backspace)
- `typeCharacter()` — replace with InputAutomation.typeText()
- `locateBetInputField()` — use config.betInputField coordinates
- `verifyTypedAmount()` — keep as placeholder unless spec requires verification

**New Requirements:**
1. **Constructor update:** Accept InputAutomation instance (or equivalent) and CoordinateContext for clicking the bet input field. BetInputHandler needs access to screen coords for the bet input field — pass via injected CoordinateContext + config.betInputField, or have InputAutomation compute them.
2. **Bet amount rounding (Req 3.5):** Rounding is done in `formatAmount()`/typing path and must be verified by Property 9. (`validateBetAmount()` validates precision; it does not round.)
3. **Minimum raise enforcement (Req 3.6):** Reject with descriptive error (recommended over round-up for clarity). Align tests with this policy.
4. **Decimal separator formatting (Req 3.7):** Already implemented via `formatAmount()`.
5. **Inter-keystroke delays (Req 3.11):** Already implemented using `deterministicRandom` (50–200ms) in `typeBetAmount()`.
6. **BetInputHandler owns full raise input flow:** Click bet input field (via InputAutomation), clear (via InputAutomation.clearTextField()), type amount (via InputAutomation.typeText with formatted string). All of this happens inside `inputBetAmount()`.

### 4.3 Wire InputAutomation into ResearchUIExecutor
File: `/Users/jonahgrigoryan/gittest/packages/executor/src/research_bridge.ts`

**Requirements:**
1. Replace stubs: Replace `moveMouse()` and `clickMouse()` with `InputAutomation.clickAt()`.
2. **Raise action sequence (Req 3.4):** BetInputHandler owns click input + clear + type. ResearchUIExecutor does:
   - Call `betInputHandler.inputBetAmount(action, windowHandle, rngSeed)` (which internally clicks field, clears, types)
   - Then click raise button (via `InputAutomation.clickAt()`)
3. **Fold/Call/Check:** Move to button, click (delay is inside `InputAutomation.clickAt()` — do NOT add delay in executor).
4. **Coordinate context:** Pass `dpiCalibration`, `layoutResolution`, and `windowBounds` into InputAutomation before each action. Update context after each window discovery (bounds may change).
5. **Human-like delay (Req 3.10):** Delay lives ONLY inside `InputAutomation.clickAt()` — do NOT add delay in executor flow to avoid double-application.
6. **Injectable:** Support optional InputAutomation injection for tests.

### 4.4 Update coordinate translation in WindowManager
File: `/Users/jonahgrigoryan/gittest/packages/executor/src/window_manager.ts`

**Requirements:**
- Add new method `visionToScreenCoords(visionX: number, visionY: number, layoutResolution: { width: number; height: number }, windowBounds: WindowBounds, dpiCalibration: number): { x: number; y: number }` that implements Property 31 formula exactly:
  ```
  screenX = windowBounds.x + (visionX / layoutResolution.width) * windowBounds.width
  screenY = windowBounds.y + (visionY / layoutResolution.height) * windowBounds.height
  ```
  Then apply `dpiCalibration` per design doc (scale the result).
- InputAutomation MUST call this method for coordinate translation — single path, no duplication.
- Avoid double-DPI: if `detectDPIScale()` or other code already applies DPI, integrate accordingly.

### 4.5 Wire factory and dependencies
File: `/Users/jonahgrigoryan/gittest/packages/executor/src/index.ts`

**Requirements:**
- Create and inject InputAutomation instance when constructing ResearchUIExecutor.
- **layoutResolution source:** Keep as executor-internal only. Do NOT add to shared `ResearchUIConfig` or schema in this PR. Use default `{ width: 1920, height: 1080 }` when constructing CoordinateContext. Avoid shared type/schema changes.
- Pass CoordinateContext (from config + window bounds) into InputAutomation.
- Pass BetInputHandler the InputAutomation instance and coordinate context.
- Support optional injection for tests via factory pattern.

## 5) Required tests (Task 4.3–4.8)

Create/extend under `/Users/jonahgrigoryan/gittest/packages/executor/test`:

### 5.1 bet_input_handler.spec.ts (extend or new)
fast-check property tests:
- **Property 9:** Bet amount rounding (Req 3.5) — validate formatAmount() output precision
- **Property 10:** Minimum raise enforcement (Req 3.6) — test rejection policy (not round-up)
- **Property 11:** Decimal separator formatting (Req 3.7) — test . vs ,
- **Property 12:** Bet amount round trip (Req 3.5, 3.7) — format then parse within tolerance

### 5.2 input_automation.spec.ts (new)
fast-check property tests:
- **Property 31:** Coordinate scaling correctness (Req 12.1, 12.2, 12.3) — validate formula via WindowManager.visionToScreenCoords
- **Property 32:** Out-of-bounds coordinate rejection (Req 12.4) — test coords outside window bounds throw/log error
- Add unit test(s) validating pre-click delay is in the 1–3s range and uses deterministic randomness inputs

### 5.3 research_bridge.spec.ts (extend)
- Test raise flow uses InputAutomation
- Test executor does not add duplicate delay outside InputAutomation click path
- Test coordinate context is updated after window discovery
- Mock nut.js/InputAutomation so tests are CI-safe (no real mouse/keyboard)

**Test constraints:**
- No real nut.js mouse/keyboard in CI — mock or inject.
- Tests must be CI-safe (mock nut.js; no real mouse/keyboard).
- Use deterministic inputs for property tests.

## 6) Tracking updates (required)
After code/tests pass:
1. Mark Task 4 and 4.1–4.8 complete in:
   - `/Users/jonahgrigoryan/gittest/.kiro/specs/coinpoker-macos-autonomy/tasks.md`
2. Add Task 4 progress entry in:
   - `/Users/jonahgrigoryan/gittest/progress.md`
Include branch, summary, and verification outcomes.

## 7) Verification commands (must pass)
Run from repo root:
- `pnpm run lint`
- `pnpm run build`
- `pnpm run test:unit`

## 8) Output format when done
Return:
1. Files changed
2. What was implemented for each subtask (4.1–4.8)
3. Verification command results
4. Any residual risks/assumptions
