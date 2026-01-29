# macOS Helper (Option B) Design

## Status
Approved by user on 2026-01-29.

## Decision Summary
Implement **Option B**: a long-lived macOS helper that owns window discovery, focus, and input injection. The Node executor becomes a thin client that sends JSON-line commands over persistent stdio. IPC (socket) can be swapped in later without changing message schema.

## Goals
- Execute poker actions reliably within seconds.
- Minimize latency and reduce misclick risk.
- Keep design compatible with later IPC migration.
- Preserve existing vision pipeline and decision logic.

## Non-Goals
- Cross-platform automation in this phase.
- Multi-table handling or multi-user flows.
- Rewriting the Python vision stack.

## Architecture Overview
- **Helper (Swift)**: Uses macOS Accessibility + CoreGraphics APIs to find window, focus it, move mouse, click, and type.
- **Node (ResearchUIExecutor)**: Sends action intents and coordinates to helper; logs results and optionally verifies via vision.

Flow per action:
1. Node validates decision and compliance checks.
2. Node sends `executeAction` to helper.
3. Helper finds/focuses the poker window, applies configurable human delay, moves mouse, clicks, types bet if needed.
4. Helper returns success/error + timings.
5. Node records result and optionally runs `ActionVerifier`.

## Transport
- **Persistent CLI over stdio** (JSON lines).
- Helper logs to stderr; stdout reserved for JSON responses.
- Node restarts helper if it exits.

## Command Schema (JSON lines)
Minimal set:
- `ping` → `{ ok, version }`
- `findWindow` → `{ ok, windowId, title, bounds, dpiScale }`
- `focusWindow` → `{ ok }`
- `executeAction` → `{ ok, timings, errorCode?, message? }`

Example `executeAction`:
```json
{
  "op": "executeAction",
  "action": "raise",
  "amount": 2.5,
  "coords": { "x": 812, "y": 742 },
  "coordSpace": "window",
  "options": {
    "humanDelayMs": [120, 300],
    "typeDelayMs": [40, 80],
    "fastMode": false
  }
}
```

## Coordinate Contract
- Default: `coordSpace: "window"` meaning coords are window-relative pixels.
- If layout packs use relative coords, Node converts them to pixels using window bounds before sending.
- Helper assumes coords are already pixel-precise in the chosen space.

## Latency Strategy
- Keep human-like delays **configurable and bounded**.
- Add `fastMode` to skip delays when `actionTimer` is short (e.g., <3s).
- Target click+type completion well under 1 second in fast mode.

## Error Handling
- Helper returns structured errors: `window_not_found`, `focus_failed`, `input_failed`, `timeout`.
- Node treats any failure as execution failure and avoids silent retries unless explicitly configured.
- If window handle becomes stale, helper re-resolves once then fails.

## Safety & Permissions
- Requires macOS Accessibility permission.
- Handle permission denial with a clear error and halt execution.
- Keep compliance checks on the Node side before sending any action.

## Testing Plan
- Helper smoke tests: `ping`, `findWindow`, `focusWindow`, `executeAction` on a dummy window.
- Node integration tests: mock helper responses and verify executor error paths.
- Manual validation against target poker client (single-table).

## Open Questions (to confirm during implementation)
- Exact coordinate source: always use action button coords from vision layout vs. direct OCR/button detection.
- Bet input confirm action: Enter key vs. click confirm (platform-dependent).
- Delay defaults: choose baseline ranges for pre-click and typing.

## Next Step
Ready to set up for implementation?
