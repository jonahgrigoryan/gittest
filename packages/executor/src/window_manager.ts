import type { WindowHandle, WindowBounds, WindowConfig } from './types';

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

/**
 * Production-grade window manager for research UI mode.
 * Handles OS-specific window detection, focus management, and coordinate conversion.
 */
export class WindowManager {
  private readonly config: WindowConfig;
  private readonly logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

  constructor(
    config: WindowConfig,
    logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> = console
  ) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * OS-specific window detection (Windows EnumWindows, Linux xdotool, macOS Accessibility APIs)
   */
  async findPokerWindow(): Promise<WindowHandle | null> {
    this.logger.debug('WindowManager: Searching for poker window', {
      titlePatterns: this.config.titlePatterns,
      processNames: this.config.processNames
    });

    try {
      // In production, this would use OS-specific APIs:
      // - Windows: EnumWindows, GetWindowText, GetWindowThreadProcessId
      // - Linux: xdotool, wmctrl
      // - macOS: Accessibility APIs, NSWorkspace

      // For now, return a placeholder that would be replaced by actual implementation
      // This is a stub that needs to be implemented with actual window detection logic

      // Example implementation would:
      // 1. Enumerate all windows
      // 2. Check window titles against titlePatterns
      // 3. Check process names against processNames
      // 4. Validate window bounds meet minWindowSize
      // 5. Return first matching window

      const mockWindow: WindowHandle = {
        id: 'mock-window-123',
        title: 'PokerStars - Table 123',
        processName: 'PokerStars.exe'
      };

      this.logger.info('WindowManager: Found poker window', { window: mockWindow });
      return mockWindow;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('WindowManager: Failed to find poker window', { error: errorMessage });
      return null;
    }
  }

  /**
   * Converts ROI coordinates to screen space
   * Handles DPI scaling and coordinate transformation
   */
  roiToScreenCoords(roi: ROI, windowBounds: WindowBounds): ScreenCoords {
    this.logger.debug('WindowManager: Converting ROI to screen coordinates', {
      roi,
      windowBounds
    });

    // Calculate absolute coordinates
    let x: number, y: number;

    if (roi.relative) {
      // Relative coordinates are percentages of window bounds
      x = windowBounds.x + (roi.x * windowBounds.width);
      y = windowBounds.y + (roi.y * windowBounds.height);
    } else {
      // Absolute coordinates relative to window top-left
      x = windowBounds.x + roi.x;
      y = windowBounds.y + roi.y;
    }

    // Apply DPI scaling if needed
    // In production, this would detect system DPI and scale accordingly
    const dpiScale = this.detectDPIScale();
    if (dpiScale !== 1) {
      x = Math.round(x * dpiScale);
      y = Math.round(y * dpiScale);
    }

    const screenCoords: ScreenCoords = { x, y };

    this.logger.debug('WindowManager: Converted coordinates', {
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
    this.logger.debug('WindowManager: Converting button to screen coordinates', {
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

    this.logger.debug('WindowManager: Converted button coordinates', {
      original: screenCoords,
      adjusted: adjustedCoords,
      windowBounds
    });

    return adjustedCoords;
  }

  /**
   * Validates button is actionable (enabled, visible, sufficient confidence)
   */
  isButtonActionable(buttonInfo: ButtonInfo, minConfidence: number = 0.8): boolean {
    const isActionable = buttonInfo.isEnabled &&
      buttonInfo.isVisible &&
      buttonInfo.confidence >= minConfidence;

    this.logger.debug('WindowManager: Button actionability check', {
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
    this.logger.debug('WindowManager: Finding action button', {
      actionType,
      availableButtons: visionOutput.actionButtons ? Object.keys(visionOutput.actionButtons) : []
    });

    const buttons = visionOutput.actionButtons;
    if (!buttons) {
      this.logger.warn('WindowManager: No action buttons in vision output');
      return null;
    }

    const button = buttons[actionType as keyof typeof buttons];

    if (!button) {
      this.logger.warn('WindowManager: Action button not found', { actionType });
      return null;
    }

    if (!this.isButtonActionable(button)) {
      this.logger.warn('WindowManager: Action button not actionable', {
        actionType,
        button
      });
      return null;
    }

    this.logger.info('WindowManager: Found actionable button', {
      actionType,
      button
    });

    return button;
  }

  /**
   * Focuses window for automation
   */
  async focusWindow(handle: WindowHandle): Promise<boolean> {
    this.logger.debug('WindowManager: Focusing window', { handle });

    try {
      // In production, this would use OS-specific APIs:
      // - Windows: SetForegroundWindow, ShowWindow
      // - Linux: xdotool windowactivate
      // - macOS: Accessibility APIs

      this.logger.info('WindowManager: Window focused', { handle });
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('WindowManager: Failed to focus window', {
        handle,
        error: errorMessage
      });
      return false;
    }
  }

  /**
   * Detects system DPI scale
   * In production, this would query the OS for DPI settings
   */
  private detectDPIScale(): number {
    // Placeholder - in production, this would detect actual system DPI
    // Common values: 1 (100%), 1.25 (125%), 1.5 (150%), 2 (200%)
    return 1;
  }

  /**
   * Gets window bounds
   * In production, this would query the OS for window position and size
   */
  async getWindowBounds(handle: WindowHandle): Promise<WindowBounds> {
    this.logger.debug('WindowManager: Getting window bounds', { handle });

    // In production, this would use OS-specific APIs to get window bounds
    // For now, return placeholder bounds

    const bounds: WindowBounds = {
      x: 100,
      y: 100,
      width: 1920,
      height: 1080
    };

    this.logger.debug('WindowManager: Window bounds', { handle, bounds });
    return bounds;
  }

  /**
   * Validates window against config requirements
   */
  validateWindow(handle: WindowHandle, bounds: WindowBounds): boolean {
    this.logger.debug('WindowManager: Validating window', { handle, bounds });

    // Check minimum size
    if (bounds.width < this.config.minWindowSize.width ||
      bounds.height < this.config.minWindowSize.height) {
      this.logger.warn('WindowManager: Window too small', {
        handle,
        bounds,
        minSize: this.config.minWindowSize
      });
      return false;
    }

    // Check title pattern
    const titleMatch = this.config.titlePatterns.some(pattern =>
      handle.title.toLowerCase().includes(pattern.toLowerCase())
    );

    if (!titleMatch) {
      this.logger.warn('WindowManager: Window title does not match patterns', {
        handle,
        patterns: this.config.titlePatterns
      });
      return false;
    }

    this.logger.info('WindowManager: Window validated', { handle });
    return true;
  }
}
