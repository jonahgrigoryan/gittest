"""gRPC server for vision service."""

import json
import time
from concurrent import futures
from typing import Any, Dict

import grpc

# Generated protobuf imports (will be generated after proto compilation)
# from vision_pb2 import VisionOutput, HealthStatus, Empty
# from vision_pb2_grpc import VisionServiceServicer, add_VisionServiceServicer_to_server

from .capture import ScreenCapture
from .extraction import extract_all_rois, ElementRecognizer
from .models import ModelManager
from .occlusion import detect_occlusion
from .output import VisionOutputBuilder
from .confidence import aggregate_confidence
from .types import LayoutPack


class VisionServicer:
    """Vision service implementation."""

    def __init__(self, model_manager: ModelManager):
        """
        Initialize vision servicer.

        Args:
            model_manager: ModelManager instance for ONNX inference
        """
        self.model_manager = model_manager
        self.screen_capture = ScreenCapture()
        self.recognizer = ElementRecognizer(model_manager)

    def CaptureFrame(self, request, context):
        """
        Capture and process frame.

        Args:
            request: CaptureRequest with layout JSON
            context: gRPC context

        Returns:
            VisionOutput proto message
        """
        try:
            # Parse layout pack
            layout_data = json.loads(request.layout_json)
            layout = LayoutPack.from_dict(layout_data)

            # Build output
            builder = VisionOutputBuilder()

            # Capture frame
            frame = self.screen_capture.capture_frame()
            builder.mark_extraction_start()

            # Extract all ROIs
            roi_images, extraction_times = extract_all_rois(frame, layout)

            # Recognize cards
            hole_cards = []
            community_cards = []
            card_confidences = []

            # First 2 cards are hole cards (from layout)
            for i in range(min(2, len(layout.card_rois))):
                roi_name = f"card_{i}"
                if roi_name in roi_images:
                    card_rec = self.recognizer.recognize_card(roi_images[roi_name])
                    hole_cards.append(
                        {"rank": card_rec.rank, "suit": card_rec.suit}
                    )
                    card_confidences.append(card_rec.confidence)

            # Remaining cards are community cards
            for i in range(2, len(layout.card_rois)):
                roi_name = f"card_{i}"
                if roi_name in roi_images:
                    card_rec = self.recognizer.recognize_card(roi_images[roi_name])
                    community_cards.append(
                        {"rank": card_rec.rank, "suit": card_rec.suit}
                    )
                    card_confidences.append(card_rec.confidence)

            # Set cards
            cards_confidence = (
                aggregate_confidence(card_confidences) if card_confidences else 0.0
            )
            builder.set_cards(hole_cards, community_cards, cards_confidence)

            # Recognize stacks
            for pos, roi in layout.stack_rois.items():
                roi_name = f"stack_{pos}"
                if roi_name in roi_images:
                    stack_rec = self.recognizer.recognize_stack(roi_images[roi_name])
                    builder.set_stack(pos, stack_rec.amount, stack_rec.confidence)

            # Recognize pot
            if "pot" in roi_images:
                pot_rec = self.recognizer.recognize_pot(roi_images["pot"])
                builder.set_pot(pot_rec.amount, pot_rec.confidence)

            # Detect dealer button
            if "button" in roi_images:
                button_det = self.recognizer.detect_dealer_button(
                    roi_images["button"]
                )
                # Simple heuristic: assume button at BTN position
                builder.set_buttons("BTN", button_det.confidence)

            # Set position confidence
            builder.set_positions(0.99)

            # Detect occlusions
            for roi_name, roi_image in roi_images.items():
                # Get corresponding ROI from layout
                roi_def = None
                if roi_name.startswith("card_"):
                    idx = int(roi_name.split("_")[1])
                    if idx < len(layout.card_rois):
                        roi_def = layout.card_rois[idx]
                elif roi_name == "pot":
                    roi_def = layout.pot_roi

                if roi_def:
                    is_occluded, occlusion_score = detect_occlusion(
                        roi_image, roi_def
                    )
                    if is_occluded:
                        builder.set_occlusion(roi_name, occlusion_score)

            # Build and return output
            output_dict = builder.build()

            # Convert to proto message (placeholder implementation)
            # In production, would properly serialize to protobuf
            return output_dict

        except Exception as e:
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"Vision processing failed: {str(e)}")
            return {}

    def HealthCheck(self, request, context):
        """Health check endpoint."""
        return {"healthy": True, "message": "Vision service is running"}


def serve(port: int = 50052, model_dir: str = "models"):
    """
    Start gRPC vision service.

    Args:
        port: Port to listen on
        model_dir: Directory containing ONNX models
    """
    # Initialize model manager
    model_manager = ModelManager(model_dir)
    try:
        model_manager.preload_models()
    except Exception as e:
        print(f"Warning: Failed to preload models: {e}")

    # Create server
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))

    # Add servicer (placeholder - would use generated code)
    # servicer = VisionServicer(model_manager)
    # add_VisionServiceServicer_to_server(servicer, server)

    # Start server
    server.add_insecure_port(f"[::]:{port}")
    server.start()
    print(f"Vision service listening on port {port}")

    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        print("\nShutting down vision service...")
        server.stop(grace=5)


if __name__ == "__main__":
    serve()
