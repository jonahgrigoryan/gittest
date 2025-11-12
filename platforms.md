# Platform-Specific APIs for Task 9 OS Automation Hooks

This document lists all OS-level APIs that need platform-specific implementations before the poker bot can interact with real poker clients. Currently, all these APIs are stubbed with mock implementations in the Task 9 code.

## Windows APIs

### Window Management (packages/executor/src/window_manager.ts)
- `EnumWindows` - Enumerate all top-level windows
- `GetWindowText` - Get window title text
- `GetWindowThreadProcessId` - Get process ID for a window
- `SetForegroundWindow` - Bring window to foreground
- `ShowWindow` - Show/hide/minimize windows
- `GetWindowRect` - Get window position and size
- `GetDpiForWindow` - Get DPI scaling for window

### Process Enumeration (packages/executor/src/compliance.ts)
- `EnumProcesses` - Enumerate all running processes
- `GetProcessImageFileName` - Get executable path for process

### Mouse & Keyboard Input (packages/executor/src/research_bridge.ts)
- `SendInput` - Send keyboard/mouse input events
- `mouse_event` - Legacy mouse input function
- `keybd_event` - Legacy keyboard input function

## macOS APIs

### Window Management (packages/executor/src/window_manager.ts)
- Accessibility APIs (System Preferences → Security & Privacy → Accessibility)
- `NSWorkspace.runningApplications` - Get list of running applications
- `CGWindowListCopyWindowInfo` - Get window information
- `AXUIElementCopyAttributeValue` - Get window attributes
- Cocoa `NSApplication` APIs for window manipulation

### Process Enumeration (packages/executor/src/compliance.ts)
- `NSWorkspace.runningApplications` - Get running applications
- `NSRunningApplication.processIdentifier` - Get process IDs

### Mouse & Keyboard Input (packages/executor/src/research_bridge.ts)
- Accessibility APIs for input simulation
- `CGEventCreateMouseEvent` - Create mouse events
- `CGEventCreateKeyboardEvent` - Create keyboard events
- `CGEventPost` - Post events to system

## Linux APIs

### Window Management (packages/executor/src/window_manager.ts)
- `xdotool` command-line utility
- `wmctrl` command-line utility
- X11 libraries (`libX11`, `libXext`)
- `XQueryTree` - Query window hierarchy
- `XGetWindowProperty` - Get window properties
- `XMoveResizeWindow` - Move/resize windows

### Process Enumeration (packages/executor/src/compliance.ts)
- `/proc` filesystem enumeration
- `ps` command or `libproc` APIs

### Mouse & Keyboard Input (packages/executor/src/research_bridge.ts)
- `xdotool` for input simulation
- `uinput` kernel module for input events
- X11 input event libraries

### Display & DPI (packages/executor/src/window_manager.ts)
- `xrandr` command for display information
- X11 display APIs for DPI detection

## Cross-Platform Libraries/Alternatives

### Node.js Native Addons
- `ffi-napi` or `node-ffi` for calling native APIs
- `ref-napi` for memory management
- `robotjs` - Cross-platform input automation (limited platforms)
- `nut-js` - Modern cross-platform automation

### Electron/Chromium APIs (if using Electron)
- `desktopCapturer` for screen/window capture
- Input simulation APIs

## Implementation Strategy

### Phase 1: Platform Detection
```typescript
export enum Platform {
  WINDOWS = 'windows',
  MACOS = 'macos',
  LINUX = 'linux'
}

export function detectPlatform(): Platform {
  const platform = process.platform;
  switch (platform) {
    case 'win32': return Platform.WINDOWS;
    case 'darwin': return Platform.MACOS;
    case 'linux': return Platform.LINUX;
    default: throw new Error(`Unsupported platform: ${platform}`);
  }
}
```

### Phase 2: Platform-Specific Implementations
Create platform-specific classes that implement common interfaces:

```typescript
interface IWindowManager {
  findPokerWindow(): Promise<WindowHandle | null>;
  focusWindow(handle: WindowHandle): Promise<boolean>;
  getWindowBounds(handle: WindowHandle): Promise<WindowBounds>;
}

interface IInputController {
  moveMouse(x: number, y: number): Promise<void>;
  clickMouse(): Promise<void>;
  typeText(text: string): Promise<void>;
}

interface IProcessEnumerator {
  getRunningProcesses(): Promise<ProcessInfo[]>;
}
```

### Phase 3: Factory Pattern
```typescript
export function createWindowManager(platform: Platform): IWindowManager {
  switch (platform) {
    case Platform.WINDOWS: return new WindowsWindowManager();
    case Platform.MACOS: return new MacOSWindowManager();
    case Platform.LINUX: return new LinuxWindowManager();
  }
}
```

## Security Considerations

### macOS Accessibility Permissions
- Must be granted in System Preferences → Security & Privacy → Accessibility
- App must be signed and notarized for production use
- Handle permission denial gracefully

### Windows UAC/Admin Rights
- Some APIs may require elevated privileges
- Consider manifest files for Windows executables

### Linux Display Server Permissions
- X11 vs Wayland compatibility
- X server access permissions

## Testing Strategy

### Virtual Environments
- Windows: Use Windows VMs or Windows containers
- macOS: Use macOS VMs (requires Apple hardware for official VMs)
- Linux: Use Docker containers or VMs

### Hardware Testing
- Dedicated test machines for each platform
- Poker client installations in isolated environments
- Screenshot/video capture for debugging

## Development Timeline

### Windows Implementation: ~1-2 weeks
- Most straightforward due to Win32 API documentation
- Good tooling support in Node.js

### macOS Implementation: ~1-2 weeks
- Accessibility APIs are well-documented
- Permission handling adds complexity

### Linux Implementation: ~1-2 weeks
- X11 APIs are mature but less documented
- Distribution compatibility considerations

## Risk Mitigation

### Fallback Strategies
- Graceful degradation when APIs fail
- Alternative input methods (e.g., fall back to xdotool on Linux)
- Clear error messages for unsupported configurations

### Compatibility Layers
- Consider using cross-platform libraries where possible
- Implement version detection for OS updates
- Handle different window managers on Linux

## Future Considerations

### Wayland Support (Linux)
- Modern Linux distributions moving to Wayland
- Different APIs than X11
- May require separate implementation

### Mobile/Tablet Support
- iOS/Android automation (future expansion)
- Touch input simulation
- Different permission models

### Accessibility Compliance
- Ensure implementations work with screen readers
- Follow platform accessibility guidelines
- Handle high contrast modes and scaling
