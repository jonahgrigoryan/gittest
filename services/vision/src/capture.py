"""Screen capture functionality."""

import platform
import numpy as np
from typing import Optional
from abc import ABC, abstractmethod


class ScreenCapture(ABC):
    """Abstract base class for screen capture."""

    def __init__(self, window_title: Optional[str] = None):
        self.window_title = window_title
        self._backend = self._initialize_backend()

    @abstractmethod
    def _initialize_backend(self):
        """Initialize platform-specific capture backend."""
        pass

    @abstractmethod
    def capture_frame(self) -> np.ndarray:
        """Capture screen or window and return as RGB numpy array."""
        pass


class LinuxScreenCapture(ScreenCapture):
    """Linux screen capture implementation."""

    def _initialize_backend(self):
        try:
            import pyscreenshot as ImageGrab
            return ImageGrab
        except ImportError:
            raise ImportError("pyscreenshot not available. Install with: pip install pyscreenshot")

    def capture_frame(self) -> np.ndarray:
        """Capture full screen using pyscreenshot."""
        try:
            # Capture full screen for now - in production would filter by window
            pil_image = self._backend.grab()
            # Convert PIL to numpy array (RGB)
            return np.array(pil_image)
        except Exception as e:
            raise RuntimeError(f"Screen capture failed: {e}")


class MacScreenCapture(ScreenCapture):
    """macOS screen capture implementation."""

    def _initialize_backend(self):
        try:
            import Quartz
            return Quartz
        except ImportError:
            raise ImportError("PyObjC not available for Quartz. Install with: pip install pyobjc")

    def capture_frame(self) -> np.ndarray:
        """Capture screen using Quartz (placeholder - needs full implementation)."""
        # Placeholder implementation
        raise NotImplementedError("macOS capture not yet implemented")


class WindowsScreenCapture(ScreenCapture):
    """Windows screen capture implementation."""

    def _initialize_backend(self):
        try:
            import mss
            return mss.mss()
        except ImportError:
            raise ImportError("mss not available. Install with: pip install mss")

    def capture_frame(self) -> np.ndarray:
        """Capture screen using mss."""
        try:
            # Capture full screen for now
            screenshot = self._backend.grab(self._backend.monitors[0])
            # Convert BGRA to RGB
            img_array = np.frombuffer(screenshot.bgra, dtype=np.uint8)
            img_array = img_array.reshape((screenshot.height, screenshot.width, 4))
            return img_array[:, :, :3]  # Remove alpha channel
        except Exception as e:
            raise RuntimeError(f"Screen capture failed: {e}")


def create_screen_capture(window_title: Optional[str] = None) -> ScreenCapture:
    """Factory function to create platform-appropriate screen capture."""
    system = platform.system().lower()

    if system == "linux":
        return LinuxScreenCapture(window_title)
    elif system == "darwin":
        return MacScreenCapture(window_title)
    elif system == "windows":
        return WindowsScreenCapture(window_title)
    else:
        raise RuntimeError(f"Unsupported platform: {system}")