"""Screen capture implementation for different platforms."""
import platform
import numpy as np
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class ScreenCapture:
    """Platform-agnostic screen capture handler."""
    
    def __init__(self, window_title: Optional[str] = None):
        """
        Initialize screen capture backend.
        
        Args:
            window_title: Optional window title to filter by
        """
        self.window_title = window_title
        self._backend = self._init_backend()
        
    def _init_backend(self):
        """Initialize platform-specific capture backend."""
        system = platform.system()
        
        if system == "Darwin":  # macOS
            try:
                from PIL import ImageGrab
                return "PIL"
            except ImportError:
                raise ImportError("PIL/Pillow required for macOS screen capture")
        
        elif system == "Linux":
            try:
                import mss
                return "mss"
            except ImportError:
                # Fallback to X11
                try:
                    from PIL import ImageGrab
                    return "PIL"
                except ImportError:
                    raise ImportError("mss or PIL required for Linux screen capture")
        
        elif system == "Windows":
            try:
                import mss
                return "mss"
            except ImportError:
                try:
                    from PIL import ImageGrab
                    return "PIL"
                except ImportError:
                    raise ImportError("mss or PIL required for Windows screen capture")
        
        else:
            raise NotImplementedError(f"Unsupported platform: {system}")
    
    def capture_frame(self) -> np.ndarray:
        """
        Capture full screen or specific window.
        
        Returns:
            numpy array in RGB format (H, W, 3)
        """
        try:
            if self._backend == "mss":
                import mss
                with mss.mss() as sct:
                    # Capture full screen
                    monitor = sct.monitors[1]  # Primary monitor
                    screenshot = sct.grab(monitor)
                    # Convert to numpy array
                    img = np.array(screenshot)
                    # mss returns BGRA, convert to RGB
                    if img.shape[2] == 4:
                        img = img[:, :, [2, 1, 0]]  # BGR -> RGB
                    return img
            
            elif self._backend == "PIL":
                from PIL import ImageGrab
                screenshot = ImageGrab.grab()
                img = np.array(screenshot)
                # PIL returns RGB already
                return img
            
            else:
                raise RuntimeError(f"Unknown backend: {self._backend}")
        
        except Exception as e:
            logger.error(f"Failed to capture frame: {e}")
            raise
