# Vision Service

Python-based vision service for poker bot screen capture and game state extraction.

## Overview

The vision service provides:
- Screen capture from poker client windows
- ROI extraction based on layout packs
- Card and digit recognition using ONNX models
- Confidence scoring and occlusion detection
- gRPC API for TypeScript orchestrator

## Architecture

```
services/vision/
??? src/
?   ??? capture.py         # Screen capture (cross-platform)
?   ??? extraction.py      # ROI extraction and element recognition
?   ??? models.py          # ONNX model management
?   ??? fallback.py        # Template matching fallback
?   ??? confidence.py      # Confidence scoring
?   ??? occlusion.py       # Occlusion detection
?   ??? output.py          # VisionOutput builder
?   ??? gating.py          # Confidence gating logic
?   ??? server.py          # gRPC server
?   ??? types.py           # Python type definitions
??? models/                # ONNX model files (.onnx)
??? pyproject.toml         # Poetry dependencies
```

## Setup

### Prerequisites

- Python 3.11.9
- Poetry
- ONNX Runtime

### Installation

```bash
cd services/vision
poetry install
```

### ONNX Models

Place trained ONNX models in `models/` directory:
- `card_rank.onnx` - Card rank recognition (13 classes: 2-A)
- `card_suit.onnx` - Card suit recognition (4 classes: h,d,c,s)
- `digit.onnx` - Stack/pot digit recognition (11 classes: 0-9 + decimal)

Model requirements:
- Input: 64x64 RGB image (normalized 0-1)
- Output: Softmax probabilities
- ONNX opset 13+

### Running the Service

```bash
# Start gRPC server
poetry run python -m src.server

# Custom port and model directory
poetry run python -m src.server --port 50052 --models models/
```

## Layout Packs

Layout packs define ROI coordinates for different poker platforms. See `config/layout-packs/` for examples.

Example layout pack:
```json
{
  "version": "1.0.0",
  "platform": "simulator",
  "theme": "default",
  "resolution": { "width": 1920, "height": 1080 },
  "dpiCalibration": 1.0,
  "cardROIs": [...],
  "stackROIs": {...},
  "potROI": {...},
  "buttonROI": {...},
  "actionButtonROIs": {...},
  "turnIndicatorROI": {...},
  "windowPatterns": {...}
}
```

## Testing

```bash
# Run tests
poetry run pytest

# With coverage
poetry run pytest --cov=src
```

## API

### CaptureFrame

Captures and processes a single frame.

**Request:**
```protobuf
message CaptureRequest {
  string layout_json = 1;  // JSON-encoded LayoutPack
}
```

**Response:**
```protobuf
message VisionOutput {
  int64 timestamp = 1;
  CardData cards = 2;
  map<string, StackData> stacks = 3;
  AmountData pot = 4;
  ButtonData buttons = 5;
  PositionData positions = 6;
  map<string, double> occlusion = 7;
  ActionButtons action_buttons = 8;
  TurnState turn_state = 9;
  LatencyData latency = 10;
}
```

### HealthCheck

Check service health.

**Request:** Empty

**Response:**
```protobuf
message HealthStatus {
  bool healthy = 1;
  string message = 2;
}
```

## Performance

- Target latency: <50ms total (capture + extraction)
- Capture: ~10ms
- Extraction: ~15ms per element
- ONNX inference: ~5ms per model

## Troubleshooting

### Screen Capture Issues

**Linux:**
- Install `python-xlib` or `mss`
- May require X11 permissions

**macOS:**
- Grant screen recording permissions in System Preferences

**Windows:**
- Install `mss` or `pywin32`
- May require admin privileges

### Low Confidence Scores

- Check ROI coordinates in layout pack
- Verify ONNX models are loaded correctly
- Use template matching fallback
- Adjust DPI calibration

### Occlusion Detection

- Popup overlays trigger high occlusion scores
- Adjust variance thresholds in `occlusion.py`
- Check for window focus issues

## Development

### Adding New Platforms

1. Create layout pack in `config/layout-packs/<platform>/`
2. Calibrate ROI coordinates for target resolution
3. Test with golden test suite
4. Add platform-specific window detection

### Training ONNX Models

1. Generate synthetic training data (cards, digits)
2. Train CNNs using PyTorch/TensorFlow
3. Export to ONNX format
4. Validate input/output shapes
5. Place in `models/` directory

## License

See workspace root for license information.
