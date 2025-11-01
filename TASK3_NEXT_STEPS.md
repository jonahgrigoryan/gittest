# Task 3 - Next Steps for Integration

## Immediate Actions Required

### 1. Regenerate Protocol Buffers

The vision.proto file has been updated with the full service definition. Regenerate TypeScript and Python stubs:

```bash
# From workspace root
pnpm run proto:gen
```

This will update:
- `packages/shared/src/gen/vision.ts` (TypeScript)
- Python gRPC stubs (if Python protoc plugin configured)

### 2. Install Python Dependencies

```bash
cd services/vision
poetry install
```

This will install the newly added `mss` dependency for screen capture.

### 3. Build TypeScript Packages

```bash
# From workspace root
pnpm run build
```

This will compile all TypeScript packages including the new vision modules.

### 4. Run Tests

```bash
# TypeScript unit tests
pnpm --filter @poker-bot/orchestrator test

# Run specific test suites
pnpm --filter @poker-bot/orchestrator test -- packages/orchestrator/test/vision/
pnpm --filter @poker-bot/orchestrator test -- packages/orchestrator/test/safety/
```

## Adding ONNX Models

### Model Requirements

Create three ONNX models and place them in `services/vision/models/`:

#### 1. Card Rank Model (`card_rank.onnx`)
- **Input**: `(1, 3, 64, 64)` - RGB image, normalized to [0, 1]
- **Output**: `(1, 13)` - Softmax probabilities
- **Classes**: `["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]`
- **Training**: Use synthetic poker card images or screenshot dataset

#### 2. Card Suit Model (`card_suit.onnx`)
- **Input**: `(1, 3, 64, 64)` - RGB image, normalized to [0, 1]
- **Output**: `(1, 4)` - Softmax probabilities
- **Classes**: `["h", "d", "c", "s"]` (hearts, diamonds, clubs, spades)
- **Training**: Use synthetic poker card images or screenshot dataset

#### 3. Digit Model (`digit.onnx`)
- **Input**: `(1, 3, 64, 64)` - RGB image, normalized to [0, 1]
- **Output**: `(1, 11)` - Softmax probabilities
- **Classes**: `["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "."]`
- **Training**: Use synthetic digit rendering or OCR dataset

### Quick Start: Placeholder Models

For testing without trained models, the system will use fallback recognition:
- Card recognition falls back to template matching
- Digit recognition returns placeholder values
- Set low confidence scores to trigger SafeAction

### Training Pipeline (Optional)

```python
# Example PyTorch ? ONNX export
import torch
import torch.onnx

# Assuming you have a trained model
model = YourCardRankCNN()
model.load_state_dict(torch.load('card_rank.pth'))
model.eval()

dummy_input = torch.randn(1, 3, 64, 64)
torch.onnx.export(
    model,
    dummy_input,
    "services/vision/models/card_rank.onnx",
    export_params=True,
    opset_version=13,
    input_names=['input'],
    output_names=['output']
)
```

## Creating Layout Packs

### For Simulator (Already Included)

The default simulator layout pack is at:
- `config/layout-packs/simulator/default.layout.json`

### For Real Poker Clients

1. **Screenshot Calibration**:
   - Take screenshots at 1920x1080 (or target resolution)
   - Identify card, stack, pot, button, and action button positions
   - Measure pixel coordinates using image editor

2. **Create Layout Pack**:
```json
{
  "version": "1.0.0",
  "platform": "pokerstars",
  "theme": "default",
  "resolution": { "width": 1920, "height": 1080 },
  "dpiCalibration": 1.0,
  "cardROIs": [
    { "x": 860, "y": 850, "width": 80, "height": 110 },
    // ... more ROIs
  ],
  "stackROIs": {
    "BTN": { "x": 1400, "y": 650, "width": 120, "height": 30 }
    // ... more positions
  },
  "potROI": { "x": 860, "y": 380, "width": 200, "height": 40 },
  "buttonROI": { "x": 1350, "y": 600, "width": 50, "height": 50 },
  "actionButtonROIs": {
    "fold": { "x": 600, "y": 950, "width": 120, "height": 50 },
    // ... more buttons
  },
  "turnIndicatorROI": { "x": 800, "y": 750, "width": 320, "height": 80 },
  "windowPatterns": {
    "titleRegex": "^PokerStars.*",
    "processName": "pokerstars",
    "className": "PokerStarsMainWindow"
  }
}
```

3. **Validate Layout Pack**:
```typescript
import { loadLayoutPack, validateLayoutPack } from "@poker-bot/shared/vision";

const pack = loadLayoutPack("path/to/layout.json");
console.log("Layout pack loaded successfully!");
```

## Adding Test Fixtures

Create test images for golden tests:

```
packages/orchestrator/test/fixtures/vision/
??? preflop/
?   ??? clean-state.png
?   ??? clean-state.expected.json
??? flop/
?   ??? three-cards.png
?   ??? three-cards.expected.json
??? turn/
?   ??? bet-scenario.png
?   ??? bet-scenario.expected.json
??? river/
?   ??? all-in.png
?   ??? all-in.expected.json
??? occlusion/
?   ??? popup-overlay.png
?   ??? popup-overlay.expected.json
??? edge-cases/
    ??? low-confidence.png
    ??? low-confidence.expected.json
```

Example expected JSON:
```json
{
  "street": "preflop",
  "pot": 1.5,
  "players": {
    "BTN": { "stack": 100 },
    "SB": { "stack": 98.5 },
    "BB": { "stack": 99 }
  },
  "communityCards": [],
  "confidence": {
    "overall": 0.998
  }
}
```

## Running the Complete System

### Terminal 1: Vision Service

```bash
cd services/vision
poetry run python -m src.server --port 50052
```

### Terminal 2: Orchestrator

```bash
cd packages/orchestrator
ENABLE_VISION=1 \
VISION_SERVICE_URL=localhost:50052 \
LAYOUT_PACK_PATH=../../config/layout-packs/simulator/default.layout.json \
VISION_TEST_CAPTURE=1 \
pnpm run start
```

## Integration Testing

### Manual Testing Checklist

- [ ] Vision service starts without errors
- [ ] Health check returns healthy status
- [ ] Screen capture succeeds
- [ ] ROI extraction completes
- [ ] ONNX models load (or fallback activates)
- [ ] VisionOutput is returned with valid structure
- [ ] Parser converts VisionOutput to GameState
- [ ] Confidence scores are in valid range [0, 1]
- [ ] Occlusion detection works
- [ ] SafeAction triggers when confidence low
- [ ] SafeAction does not trigger when confidence high
- [ ] Forced actions are detected correctly

### Automated Testing

```bash
# Run all tests
pnpm test

# Run vision tests only
pnpm --filter @poker-bot/orchestrator test -- test/vision/

# Run safety tests only
pnpm --filter @poker-bot/orchestrator test -- test/safety/

# Watch mode
pnpm --filter @poker-bot/orchestrator test -- --watch
```

## Troubleshooting

### Proto Generation Issues

If proto generation fails:
```bash
# Check buf is installed
buf --version

# Check protoc is installed
protoc --version

# Manually generate
cd proto
buf generate
```

### Python Import Errors

If Python imports fail after proto generation:
```bash
cd services/vision
# Make sure proto output is in Python path
export PYTHONPATH="${PYTHONPATH}:/workspace/services/vision/src"
```

### TypeScript Compilation Errors

If TypeScript compilation fails:
```bash
# Clean build artifacts
pnpm run clean

# Rebuild from scratch
pnpm install
pnpm run build
```

### Screen Capture Issues

**Linux:**
```bash
# Install X11 dependencies
sudo apt-get install python3-xlib

# Grant screen recording permissions
xhost +
```

**macOS:**
- System Preferences ? Security & Privacy ? Privacy ? Screen Recording
- Enable for Terminal or your IDE

**Windows:**
- May require running with administrator privileges

### Low Confidence Issues

If confidence is consistently low:
1. Check ROI coordinates are correct for your resolution
2. Verify DPI scaling matches system settings
3. Adjust confidence thresholds in BotConfig
4. Use DPI calibration utility: `calibrateLayoutPack(pack, targetDPI)`

## Performance Optimization

### Latency Targets

- **Capture**: <10ms
- **Extraction**: <15ms total
- **ONNX Inference**: <5ms per model
- **Total**: <50ms end-to-end

### Optimization Tips

1. **Preload Models**: Call `model_manager.preload_models()` at startup
2. **ROI Caching**: Cache ROI images if layout doesn't change
3. **Parallel Inference**: Run multiple ONNX models in parallel
4. **GPU Acceleration**: Use ONNX Runtime GPU provider if available
5. **Batch Inference**: Batch multiple ROIs together

## Production Deployment

### Environment Configuration

```bash
# .env file
ENABLE_VISION=1
VISION_SERVICE_URL=localhost:50052
LAYOUT_PACK_PATH=/path/to/layout.json
BOT_CONFIG=/path/to/bot.json

# Optional
CONFIG_WATCH=1  # Auto-reload config changes
VISION_TEST_CAPTURE=0  # Disable test mode
```

### Docker Deployment (Optional)

See `infra/compose/docker-compose.yml` for service definitions.

### Monitoring

Key metrics to track:
- Vision latency (capture, extraction, total)
- Confidence scores (overall, per-element)
- Occlusion frequency
- SafeAction trigger rate
- Parse error frequency
- State sync inconsistency count

## Documentation

All documentation is in place:
- `services/vision/README.md` - Vision service guide
- `TASK3_IMPLEMENTATION_SUMMARY.md` - Complete implementation summary
- `TASK3_NEXT_STEPS.md` - This file
- Inline code comments throughout

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review test files for usage examples
3. Consult the vision service README
4. Check proto definitions for API contracts

---

**Status**: Task 3 implementation is complete and ready for integration testing once proto files are regenerated and ONNX models are added.
