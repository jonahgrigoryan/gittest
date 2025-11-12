# Task 9 (Action Executor) Verification Report

## ✅ Overall Assessment

**Status**: Outline is **well-structured and comprehensive** with **minor clarifications needed**.

The task correctly addresses all execution requirements (5.1-5.7) and integrates properly with Tasks 1-8.

---

## Issues Found

### **Issue #1: Package Structure Mismatch** ⚠️

**Lines affected**: 178, 204, 206, 324

**Problem**: task9.md places Window Manager and Compliance Checker in **orchestrator** package:
```
packages/orchestrator/src/execution/window_manager.ts  (line 178)
packages/orchestrator/src/execution/compliance.ts       (line 204)
packages/orchestrator/src/execution/executor.ts         (line 324)
```

But also references them from **executor** package:
```typescript
// Line 235-236
import { WindowManager } from '../../orchestrator/src/execution/window_manager';
import { ComplianceChecker } from '../../orchestrator/src/execution/compliance';
```

**Issue**: Cross-package imports like `../../orchestrator/` violate workspace boundaries.

**Fix needed**: Choose one location:
- **Option A**: Keep in orchestrator (execution logic), executor only imports
- **Option B**: Move to executor package (co-located with executors)

**Recommendation**: Move to executor package for better cohesion:
```
packages/executor/src/window_manager.ts
packages/executor/src/compliance.ts
```

---

### **Issue #2: Missing VisionClient Dependency** ⚠️

**Line 283**: Action Verifier needs VisionClient:
```typescript
export class ActionVerifier {
  constructor(private visionClient: VisionClient) {}
```

**Problem**: `VisionClient` type is not imported or defined. Should be:
```typescript
import type { VisionClient } from '@poker-bot/shared';  // or orchestrator
```

**Fix needed**: Specify where `VisionClient` comes from (likely from orchestrator's vision module).

---

### **Issue #3: Incomplete Type Definitions** ⚠️

**Lines 122-128**: Several types referenced but not defined:

```typescript
private translateToSimulatorCommand(action: Action): SimulatorCommand {
  // SimulatorCommand not defined
}

private async callSimulatorAPI(command: SimulatorCommand, timeoutMs: number): Promise<APIResponse> {
  // APIResponse not defined
}
```

**Fix needed**: Add to `types.ts`:
```typescript
export interface SimulatorCommand {
  action: string;
  amount?: number;
  // ... simulator-specific fields
}

export interface APIResponse {
  success: boolean;
  error?: string;
  // ... simulator response fields
}
```

---

### **Issue #4: WindowHandle Type Missing** ⚠️

**Lines 187, 198, 253, 262**: References `WindowHandle` type but never defines it.

**Fix needed**: Add to types or window_manager:
```typescript
export type WindowHandle = string | number;  // platform-specific
```

---

### **Issue #5: Config Schema Already Has Execution Section** ℹ️

**Line 497**: task9.md wants to add execution config, but it already exists:

**Current config** (from earlier review):
```json
"execution": {
  "mode": { "enum": ["simulator", "api", "research_ui"] }
}
```

**task9.md adds** (lines 500-516):
```json
"execution": {
  "enabled": { "type": "boolean" },  // NEW
  "mode": ...,
  "verifyActions": ...,              // NEW
  ...
}
```

**Fix needed**: task9.md should say "**Extend** existing execution section" not "Update", and merge with existing schema.

---

### **Issue #6: Research UI Build Flag Not Explained** ⚠️

**Lines 225, 605**: Mentions `--research-ui` build flag but doesn't specify:
- How to set it (environment variable? compile flag?)
- Where to check it (`process.env.RESEARCH_UI_ENABLED`?)
- How it gates execution

**Fix needed**: Add explicit implementation:
```typescript
// In compliance.ts
export function isResearchUIModeAllowed(): boolean {
  return process.env.RESEARCH_UI_ENABLED === 'true';
}
```

---

### **Issue #7: Missing ScreenCoords Type** ⚠️

**Line 181**: References `ScreenCoords` from `@poker-bot/shared` but this type may not exist yet.

**Check**: Verify if `ScreenCoords` is defined in shared package. If not, add:
```typescript
export interface ScreenCoords {
  x: number;
  y: number;
}
```

---

## ✅ Things Done Well

1. **Proper separation of concerns** - Simulator vs Research UI vs API executors
2. **Compliance checks integrated** - Matches Requirement 0.2-0.5
3. **Action verification with retry** - Matches Requirement 5.4-5.5
4. **Comprehensive test coverage** - Unit, integration, E2E
5. **Config-driven execution** - Enabled/disabled, modes, timeouts
6. **Vision integration for buttons** - Python button detection matches Requirements 5.7.3-5.7.4

---

## Requirements Coverage Check

| Requirement | Covered | Notes |
|-------------|---------|-------|
| 5.1 Simulator/API default | ✅ | §9.1 |
| 5.2 Research UI allowlist | ✅ | §9.2.2 |
| 5.3 Refuse prohibited sites | ✅ | §9.2.2 |
| 5.4 Verify execution | ✅ | §9.3 |
| 5.5 Re-evaluate on mismatch | ✅ | §9.3.1 line 306-312 |
| 5.6 Precise bet sizing | ✅ | §9.1.4 (brief) |
| 5.7.1 Window detection | ✅ | §9.2.1 line 187 |
| 5.7.2 Window validation | ✅ | §9.2.1 line 188 |
| 5.7.3 Turn detection | ✅ | §9.4 line 389-392 |
| 5.7.4 Button detection >99% | ✅ | §9.4 line 418 |
| 5.7.5 ROI→screen coords | ✅ | §9.2.1 line 193 |
| 5.7.6 Mouse clicks w/ timing | ✅ | §9.2.3 line 263 |
| 5.7.7 Button fallback | ✅ | Implied in verification |

---

## Tasks.md Alignment

| tasks.md Item | task9.md Section | Status |
|---------------|------------------|---------|
| 9.1 Simulator/API | §9.1 | ✅ Matches |
| 9.2 Research UI + compliance | §9.2 | ✅ Matches |
| 9.3 Action verification | §9.3 | ✅ Matches |
| 9.4 Bet sizing precision | §9.1.4 (brief) | ⚠️ Could be more detailed |
| 9.5 Window Manager | §9.2.1 | ✅ Matches |
| 9.6 Vision button extension | §9.4 | ✅ Matches |
| 9.7 Research UI enhancement | §9.2.3 | ✅ Matches |

---

## Recommendations

### **Must Fix** (Breaks compilation):
1. ✅ Resolve package structure (window_manager location)
2. ✅ Define missing types (SimulatorCommand, APIResponse, WindowHandle, ScreenCoords)
3. ✅ Import VisionClient properly

### **Should Fix** (Prevents correct implementation):
4. ✅ Clarify --research-ui build flag mechanism
5. ✅ Expand bet sizing precision section (§9.1.4 is just stub)

### **Nice to Have**:
6. ℹ️ Merge with existing config schema more explicitly
7. ℹ️ Add cross-platform automation library suggestions (robotjs, nut.js, etc.)

---

## Conclusion

**Task 9 outline is 85% production-ready.**

**Action items before implementation:**
1. Fix package structure (Issue #1)
2. Add missing type definitions (Issues #2-4, #7)
3. Clarify build flag mechanism (Issue #6)
4. Expand bet sizing section

Once these are addressed, the outline will be complete and an agent can implement it without ambiguity.
