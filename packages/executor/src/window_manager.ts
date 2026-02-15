import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import type { WindowHandle, WindowBounds, WindowConfig } from "./types";

const execFileAsync = promisify(execFile);

const DEFAULT_MIN_WINDOW_SIZE = { width: 800, height: 600 } as const;

interface DiscoveredWindow {
  handle: WindowHandle;
  bounds: WindowBounds;
  titlePatternIndex: number;
  processPatternIndex: number;
}

export interface AppleScriptRunner {
  run(script: string): Promise<string>;
}

export class OsaScriptRunner implements AppleScriptRunner {
  async run(script: string): Promise<string> {
    const { stdout } = await execFileAsync("osascript", ["-e", script]);
    return stdout.trim();
  }
}

// Local interfaces to avoid import issues
interface ScreenCoords {
  x: number;
  y: number;
}

interface ROI {
  x: number;
  y: number;
  width: number;
  height: number;
  relative?: boolean;
}

interface ButtonInfo {
  screenCoords: ScreenCoords;
  isEnabled: boolean;
  isVisible: boolean;
  confidence: number;
  text?: string;
}

interface VisionOutput {
  actionButtons?: {
    fold?: ButtonInfo;
    check?: ButtonInfo;
    call?: ButtonInfo;
    raise?: ButtonInfo;
    bet?: ButtonInfo;
    allIn?: ButtonInfo;
  };
}

function escapeAppleScriptString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ");
}

/**
 * Production-grade window manager for research UI mode.
 * Handles OS-specific window detection, focus management, and coordinate conversion.
 */
export class WindowManager {
  private readonly config: WindowConfig;
  private readonly logger: Pick<Console, "debug" | "info" | "warn" | "error">;
  private readonly appleScriptRunner: AppleScriptRunner;
  private dpiScaleCache?: number;

  constructor(
    config: WindowConfig,
    logger: Pick<Console, "debug" | "info" | "warn" | "error"> = console,
    appleScriptRunner: AppleScriptRunner = new OsaScriptRunner()
  ) {
    this.config = {
      titlePatterns: config.titlePatterns ?? [],
      processNames: config.processNames ?? [],
      minWindowSize: config.minWindowSize ?? {
        width: DEFAULT_MIN_WINDOW_SIZE.width,
        height: DEFAULT_MIN_WINDOW_SIZE.height
      }
    };
    this.logger = logger;
    this.appleScriptRunner = appleScriptRunner;
  }

  /**
   * macOS window discovery via AppleScript.
   */
  async findPokerWindow(): Promise<WindowHandle | null> {
    this.logger.debug("WindowManager: Searching for poker window", {
      titlePatterns: this.config.titlePatterns,
      processNames: this.config.processNames
    });

    if (!this.hasDiscoverySelectors()) {
      this.logger.error("WindowManager: Discovery selectors are empty; refusing to scan all windows");
      return null;
    }

    try {
      const output = await this.appleScriptRunner.run(this.buildWindowDiscoveryScript());
      const discoveredWindows = this.parseDiscoveredWindows(output);

      if (discoveredWindows.length === 0) {
        this.logger.info("WindowManager: No windows discovered");
        return null;
      }

      const rankedMatches = discoveredWindows
        .filter((candidate) => this.isDiscoveryCandidate(candidate))
        .sort((left, right) => this.compareDiscoveryCandidates(left, right));

      for (const candidate of rankedMatches) {
        if (this.validateWindow(candidate.handle, candidate.bounds)) {
          this.logger.info("WindowManager: Found poker window", { window: candidate.handle });
          return candidate.handle;
        }
      }

      this.logger.warn("WindowManager: No valid poker window found");
      return null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.logger.error("WindowManager: Failed to find poker window", { error: errorMessage });
      return null;
    }
  }

  /**
   * Converts ROI coordinates to screen space
   * Handles DPI scaling and coordinate transformation
   */
  roiToScreenCoords(roi: ROI, windowBounds: WindowBounds): ScreenCoords {
    this.logger.debug("WindowManager: Converting ROI to screen coordinates", {
      roi,
      windowBounds
    });

    // Calculate absolute coordinates
    let x: number;
    let y: number;

    if (roi.relative) {
      // Relative coordinates are percentages of window bounds
      x = windowBounds.x + roi.x * windowBounds.width;
      y = windowBounds.y + roi.y * windowBounds.height;
    } else {
      // Absolute coordinates relative to window top-left
      x = windowBounds.x + roi.x;
      y = windowBounds.y + roi.y;
    }

    // Apply DPI scaling if needed
    const dpiScale = this.detectDPIScale();
    if (dpiScale !== 1) {
      x = Math.round(x * dpiScale);
      y = Math.round(y * dpiScale);
    }

    const screenCoords: ScreenCoords = { x, y };

    this.logger.debug("WindowManager: Converted coordinates", {
      roi,
      windowBounds,
      screenCoords,
      dpiScale
    });

    return screenCoords;
  }

  /**
   * Converts vision button coordinates to screen space
   */
  buttonToScreenCoords(buttonInfo: ButtonInfo, windowBounds: WindowBounds): ScreenCoords {
    this.logger.debug("WindowManager: Converting button to screen coordinates", {
      buttonInfo,
      windowBounds
    });

    // Use existing ButtonInfo.screenCoords from vision system
    const { screenCoords } = buttonInfo;

    // Adjust for window position
    const adjustedCoords: ScreenCoords = {
      x: windowBounds.x + screenCoords.x,
      y: windowBounds.y + screenCoords.y
    };

    this.logger.debug("WindowManager: Converted button coordinates", {
      original: screenCoords,
      adjusted: adjustedCoords,
      windowBounds
    });

    return adjustedCoords;
  }

  /**
   * Validates button is actionable (enabled, visible, sufficient confidence)
   */
  isButtonActionable(buttonInfo: ButtonInfo, minConfidence = 0.8): boolean {
    const isActionable =
      buttonInfo.isEnabled && buttonInfo.isVisible && buttonInfo.confidence >= minConfidence;

    this.logger.debug("WindowManager: Button actionability check", {
      buttonInfo,
      minConfidence,
      isActionable
    });

    return isActionable;
  }

  /**
   * Finds best action button from vision output
   */
  findActionButton(visionOutput: VisionOutput, actionType: string): ButtonInfo | null {
    this.logger.debug("WindowManager: Finding action button", {
      actionType,
      availableButtons: visionOutput.actionButtons ? Object.keys(visionOutput.actionButtons) : []
    });

    const buttons = visionOutput.actionButtons;
    if (!buttons) {
      this.logger.warn("WindowManager: No action buttons in vision output");
      return null;
    }

    const button = buttons[actionType as keyof typeof buttons];

    if (!button) {
      this.logger.warn("WindowManager: Action button not found", { actionType });
      return null;
    }

    if (!this.isButtonActionable(button)) {
      this.logger.warn("WindowManager: Action button not actionable", {
        actionType,
        button
      });
      return null;
    }

    this.logger.info("WindowManager: Found actionable button", {
      actionType,
      button
    });

    return button;
  }

  /**
   * Focuses window for automation
   */
  async focusWindow(handle: WindowHandle): Promise<boolean> {
    this.logger.debug("WindowManager: Focusing window", { handle });

    const escapedProcessName = escapeAppleScriptString(handle.processName);
    const escapedTitle = escapeAppleScriptString(handle.title);
    const windowSelector = this.windowSelectorForHandle(handle, escapedTitle);
    const script = `
tell application "${escapedProcessName}" to activate
tell application "System Events"
  if not (exists process "${escapedProcessName}") then
    error "Process not running: ${escapedProcessName}"
  end if
  tell process "${escapedProcessName}"
    set frontmost to true
    set targetWindow to ${windowSelector}
    set index of targetWindow to 1
    delay 0.05
    if not (exists front window) then
      error "No front window after focus"
    end if
    set activeWindowName to name of front window
    if activeWindowName is not "${escapedTitle}" then
      error "Focused window mismatch: expected ${escapedTitle} got " & activeWindowName
    end if
  end tell
end tell
return "ok"
`;

    try {
      const output = await this.appleScriptRunner.run(script);
      if (output.trim().toLowerCase() !== "ok") {
        this.logger.error("WindowManager: Focus script returned non-success output", {
          handle,
          output
        });
        return false;
      }
      this.logger.info("WindowManager: Window focused", { handle });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.logger.error("WindowManager: Failed to focus window", {
        handle,
        error: errorMessage
      });
      return false;
    }
  }

  /**
   * Detects system DPI scale.
   * Uses macOS display settings when available and falls back to 1.
   */
  private detectDPIScale(): number {
    if (this.dpiScaleCache !== undefined) {
      return this.dpiScaleCache;
    }

    this.dpiScaleCache = 1;
    if (process.platform !== "darwin") {
      return this.dpiScaleCache;
    }

    const envScaleValue = process.env.COINPOKER_DPI_SCALE ?? process.env.APPLE_DISPLAY_SCALE_FACTOR;
    if (envScaleValue !== undefined) {
      const parsed = Number(envScaleValue);
      if (Number.isFinite(parsed) && parsed > 0) {
        this.dpiScaleCache = parsed;
        return this.dpiScaleCache;
      }
    }

    try {
      const defaultsOutput = execFileSync("defaults", ["read", "-g", "AppleDisplayScaleFactor"], {
        encoding: "utf8"
      }).trim();
      const parsedScale = Number(defaultsOutput);
      if (Number.isFinite(parsedScale) && parsedScale > 0) {
        this.dpiScaleCache = parsedScale;
        return this.dpiScaleCache;
      }
    } catch (error) {
      this.logger.debug("WindowManager: AppleDisplayScaleFactor not available", {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    try {
      const displayInfo = execFileSync("system_profiler", ["SPDisplaysDataType", "-json"], {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024
      });
      this.dpiScaleCache = /spdisplays_retina"\s*:\s*"spdisplays_yes"/i.test(displayInfo)
        ? 2
        : 1;
    } catch (error) {
      this.logger.debug("WindowManager: Unable to read system display info", {
        error: error instanceof Error ? error.message : String(error)
      });
      this.dpiScaleCache = 1;
    }

    return this.dpiScaleCache;
  }

  /**
   * Gets window bounds from macOS via AppleScript.
   */
  async getWindowBounds(handle: WindowHandle): Promise<WindowBounds> {
    this.logger.debug("WindowManager: Getting window bounds", { handle });

    const escapedProcessName = escapeAppleScriptString(handle.processName);
    const escapedTitle = escapeAppleScriptString(handle.title);
    const windowSelector = this.windowSelectorForHandle(handle, escapedTitle);
    const script = `
tell application "System Events"
  if not (exists process "${escapedProcessName}") then
    error "Process not running: ${escapedProcessName}"
  end if
  tell process "${escapedProcessName}"
    set targetWindow to ${windowSelector}
    set {xPos, yPos} to position of targetWindow
    set {w, h} to size of targetWindow
    return xPos & "||" & yPos & "||" & w & "||" & h
  end tell
end tell
`;

    try {
      const output = await this.appleScriptRunner.run(script);
      const parsedBounds = this.parseBounds(output);
      if (!parsedBounds) {
        throw new Error(`Unable to parse bounds output: "${output}"`);
      }
      this.logger.debug("WindowManager: Window bounds", { handle, bounds: parsedBounds });
      return parsedBounds;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.logger.error("WindowManager: Failed to get window bounds", {
        handle,
        error: errorMessage
      });
      throw error instanceof Error ? error : new Error(errorMessage);
    }
  }

  /**
   * Validates window against config requirements
   */
  validateWindow(handle: WindowHandle, bounds: WindowBounds): boolean {
    this.logger.debug("WindowManager: Validating window", { handle, bounds });

    // Check minimum size
    if (
      bounds.width < this.config.minWindowSize.width ||
      bounds.height < this.config.minWindowSize.height
    ) {
      this.logger.warn("WindowManager: Window too small", {
        handle,
        bounds,
        minSize: this.config.minWindowSize
      });
      return false;
    }

    // Check process name (if configured)
    const processMatch =
      this.config.processNames.length === 0 ||
      this.config.processNames.some((pattern) => this.matchesPattern(handle.processName, pattern));
    if (!processMatch) {
      this.logger.warn("WindowManager: Window process does not match patterns", {
        handle,
        patterns: this.config.processNames
      });
      return false;
    }

    // Check title pattern (if configured)
    const titleMatch =
      this.config.titlePatterns.length === 0 ||
      this.config.titlePatterns.some((pattern) => this.matchesPattern(handle.title, pattern));

    if (!titleMatch) {
      this.logger.warn("WindowManager: Window title does not match patterns", {
        handle,
        patterns: this.config.titlePatterns
      });
      return false;
    }

    this.logger.info("WindowManager: Window validated", { handle });
    return true;
  }

  private buildWindowDiscoveryScript(): string {
    return `
set output to ""
tell application "System Events"
  repeat with proc in (application processes whose background only is false)
    set procName to name of proc
    set winCount to count of windows of proc
    repeat with idx from 1 to winCount
      try
        set winRef to window idx of proc
        set winTitle to name of winRef
        set {xPos, yPos} to position of winRef
        set {w, h} to size of winRef
        set output to output & procName & "||" & idx & "||" & winTitle & "||" & xPos & "||" & yPos & "||" & w & "||" & h & linefeed
      end try
    end repeat
  end repeat
end tell
return output
`;
  }

  private parseDiscoveredWindows(output: string): DiscoveredWindow[] {
    if (output.trim().length === 0) {
      return [];
    }

    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const windows: DiscoveredWindow[] = [];
    for (const [lineIndex, line] of lines.entries()) {
      const parsed = this.parseDiscoveredWindow(line, lineIndex + 1);
      if (parsed) {
        windows.push(parsed);
      }
    }
    return windows;
  }

  private hasDiscoverySelectors(): boolean {
    return this.config.titlePatterns.length > 0 || this.config.processNames.length > 0;
  }

  private parseDiscoveredWindow(line: string, fallbackIndex: number): DiscoveredWindow | null {
    const parts = line.split("||");
    let processName: string;
    let title: string;
    let windowIndex: number;
    let xRaw: string;
    let yRaw: string;
    let widthRaw: string;
    let heightRaw: string;

    if (parts.length >= 7) {
      [processName, windowIndex, title, xRaw, yRaw, widthRaw, heightRaw] = [
        parts[0],
        Number(parts[1]),
        parts[2],
        parts[3],
        parts[4],
        parts[5],
        parts[6]
      ];
    } else if (parts.length >= 6) {
      [processName, title, xRaw, yRaw, widthRaw, heightRaw] = [
        parts[0],
        parts[1],
        parts[2],
        parts[3],
        parts[4],
        parts[5]
      ];
      windowIndex = fallbackIndex;
    } else {
      this.logger.debug("WindowManager: Ignoring malformed discovery line", { line });
      return null;
    }

    const bounds = this.parseBounds([xRaw, yRaw, widthRaw, heightRaw]);
    if (!bounds) {
      this.logger.debug("WindowManager: Ignoring line with invalid bounds", { line });
      return null;
    }

    const cleanProcessName = processName.trim();
    const cleanTitle = title.trim();
    if (cleanProcessName.length === 0 || cleanTitle.length === 0) {
      this.logger.debug("WindowManager: Ignoring line with empty process/title", { line });
      return null;
    }

    const validWindowIndex = Number.isInteger(windowIndex) && windowIndex > 0 ? windowIndex : fallbackIndex;
    return {
      handle: {
        id: `${cleanProcessName}:${validWindowIndex}`,
        title: cleanTitle,
        processName: cleanProcessName
      },
      bounds,
      titlePatternIndex: this.findMatchingPatternIndex(cleanTitle, this.config.titlePatterns),
      processPatternIndex: this.findMatchingPatternIndex(cleanProcessName, this.config.processNames)
    };
  }

  private parseBounds(raw: string | string[]): WindowBounds | null {
    let components: string[];
    if (Array.isArray(raw)) {
      components = raw;
    } else if (raw.includes("||")) {
      components = raw.split("||");
    } else {
      components = raw.split(",").map((part) => part.trim());
    }

    if (components.length < 4) {
      return null;
    }

    const [x, y, width, height] = components.slice(0, 4).map((value) => Number(value));
    if (![x, y, width, height].every((value) => Number.isFinite(value))) {
      return null;
    }

    return { x, y, width, height };
  }

  private isDiscoveryCandidate(candidate: DiscoveredWindow): boolean {
    const titleAllowed =
      this.config.titlePatterns.length === 0 || candidate.titlePatternIndex !== -1;
    const processAllowed =
      this.config.processNames.length === 0 || candidate.processPatternIndex !== -1;
    return titleAllowed && processAllowed;
  }

  private compareDiscoveryCandidates(left: DiscoveredWindow, right: DiscoveredWindow): number {
    const titleOrderLeft = left.titlePatternIndex === -1 ? Number.MAX_SAFE_INTEGER : left.titlePatternIndex;
    const titleOrderRight =
      right.titlePatternIndex === -1 ? Number.MAX_SAFE_INTEGER : right.titlePatternIndex;
    if (titleOrderLeft !== titleOrderRight) {
      return titleOrderLeft - titleOrderRight;
    }

    const processOrderLeft =
      left.processPatternIndex === -1 ? Number.MAX_SAFE_INTEGER : left.processPatternIndex;
    const processOrderRight =
      right.processPatternIndex === -1 ? Number.MAX_SAFE_INTEGER : right.processPatternIndex;
    if (processOrderLeft !== processOrderRight) {
      return processOrderLeft - processOrderRight;
    }

    const leftArea = left.bounds.width * left.bounds.height;
    const rightArea = right.bounds.width * right.bounds.height;
    return rightArea - leftArea;
  }

  private findMatchingPatternIndex(value: string, patterns: string[]): number {
    if (patterns.length === 0) {
      return 0;
    }
    return patterns.findIndex((pattern) => this.matchesPattern(value, pattern));
  }

  private matchesPattern(value: string, pattern: string): boolean {
    if (value.toLowerCase().includes(pattern.toLowerCase())) {
      return true;
    }

    try {
      return new RegExp(pattern, "i").test(value);
    } catch {
      return false;
    }
  }

  private windowSelectorForHandle(handle: WindowHandle, escapedTitle: string): string {
    const parsedWindowIndex = this.extractWindowIndex(handle.id);
    if (parsedWindowIndex !== null) {
      return `window ${parsedWindowIndex}`;
    }
    return `first window whose name is "${escapedTitle}"`;
  }

  private extractWindowIndex(windowId: WindowHandle["id"]): number | null {
    if (typeof windowId === "number") {
      return Number.isInteger(windowId) && windowId > 0 ? windowId : null;
    }

    if (typeof windowId !== "string") {
      return null;
    }

    const delimiterIndex = windowId.lastIndexOf(":");
    const suffix = delimiterIndex >= 0 ? windowId.slice(delimiterIndex + 1) : windowId;
    const parsed = Number(suffix);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
}
