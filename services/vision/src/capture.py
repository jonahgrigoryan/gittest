"""Screen capture module for poker table frames."""

import sys
import numpy as np
from typing import Optional


class ScreenCapture:
    """Cross-platform screen capture for poker tables."""

    def __init__(self, window_title: Optional[str] = None):
        """
        Initialize screen capture.

        Args:
            window_title: Optional window title to filter capture to specific window
        """
        self.window_title = window_title
        self.platform = sys.platform
        self._init_backend()

    def _init_backend(self) -> None:
        """Initialize platform-specific capture backend."""
        if self.platform == "linux":
            self._init_linux()
        elif self.platform == "darwin":
            self._init_macos()
        elif self.platform == "win32":
            self._init_windows()
        else:
            raise RuntimeError(f"Unsupported platform: {self.platform}")

    def _init_linux(self) -> None:
        """Initialize Linux capture (using mss as fallback)."""
        try:
            import mss

            self.mss = mss.mss()
        except ImportError:
            raise RuntimeError(
                "mss library required for Linux screen capture. Install with: pip install mss"
            )

    def _init_macos(self) -> None:
        """Initialize macOS capture (using mss)."""
        try:
            import mss

            self.mss = mss.mss()
        except ImportError:
            raise RuntimeError(
                "mss library required for macOS screen capture. Install with: pip install mss"
            )

    def _init_windows(self) -> None:
        """Initialize Windows capture (using mss)."""
        try:
            import mss

            self.mss = mss.mss()
        except ImportError:
            raise RuntimeError(
                "mss library required for Windows screen capture. Install with: pip install mss"
            )

    def capture_frame(self) -> np.ndarray:
        """
        Capture current frame from screen.

        Returns:
            numpy array in RGB format (H, W, 3)

        Raises:
            RuntimeError: If capture fails
        """
        try:
            # Capture primary monitor
            monitor = self.mss.monitors[1]  # Primary monitor
            screenshot = self.mss.grab(monitor)

            # Convert to numpy array (BGRA -> RGB)
            frame = np.array(screenshot)
            frame = frame[:, :, :3]  # Remove alpha channel
            frame = frame[:, :, ::-1]  # BGR -> RGB

            return frame
        except Exception as e:
            raise RuntimeError(f"Screen capture failed: {e}")

    def __del__(self):
        """Cleanup resources."""
        if hasattr(self, "mss"):
            self.mss.close()
