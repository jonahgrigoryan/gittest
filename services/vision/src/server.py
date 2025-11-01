"""gRPC server for vision service."""

import json
import time
import grpc
from concurrent import futures
import threading

# Import generated protobuf code (would be generated from proto/vision.proto)
# from . import vision_pb2
# from . import vision_pb2_grpc

# Placeholder imports for now
import sys
sys.path.append('../gen')  # Would contain generated protobuf code

from .capture import create_screen_capture
from .extraction import extract_all_rois, ElementRecognizer
from .models import ModelManager
from .output import VisionOutputBuilder
from .occlusion import detect_occlusion
from .confidence import compute_overall_confidence


class VisionServicer:
    """gRPC service implementation."""

    def __init__(self, model_manager: ModelManager):
        self.model_manager = model_manager
        self.screen_capture = create_screen_capture()
        self.element_recognizer = ElementRecognizer(model_manager)

    def CaptureFrame(self, request, context):
        """Capture frame and extract vision data."""
        start_time = time.time()

        try:
            # Parse layout pack
            layout = json.loads(request.layout_json)

            # Capture screen
            capture_start = time.time()
            frame = self.screen_capture.capture_frame()
            capture_time = time.time() - capture_start

            # Extract ROIs
            extraction_start = time.time()
            extracted_rois = extract_all_rois(frame, layout)
            extraction_time = time.time() - extraction_start

            # Build vision output
            builder = VisionOutputBuilder()

            # Process cards
            hole_cards = []
            community_cards = []

            # Extract and recognize cards
            for i in range(2):  # 2 hole cards
                roi_key = f'card_{i}'
                if roi_key in extracted_rois and 'image' in extracted_rois[roi_key]:
                    card_data = self.element_recognizer.recognize_card(extracted_rois[roi_key]['image'])
                    if card_data['confidence'] > 0.5:
                        hole_cards.append({
                            'rank': card_data['rank'],
                            'suit': card_data['suit']
                        })

            # Community cards (3-5 cards depending on street)
            for i in range(5):
                roi_key = f'card_{i+2}'  # Offset by 2 for hole cards
                if roi_key in extracted_rois and 'image' in extracted_rois[roi_key]:
                    card_data = self.element_recognizer.recognize_card(extracted_rois[roi_key]['image'])
                    if card_data['confidence'] > 0.5:
                        community_cards.append({
                            'rank': card_data['rank'],
                            'suit': card_data['suit']
                        })

            builder.set_cards(hole_cards, community_cards, 0.9)

            # Process stacks
            for position, roi in layout.get('stackROIs', {}).items():
                roi_key = f'stack_{position}'
                if roi_key in extracted_rois and 'image' in extracted_rois[roi_key]:
                    stack_data = self.element_recognizer.recognize_stack(extracted_rois[roi_key]['image'])
                    builder.set_stack(position, stack_data['amount'], stack_data['confidence'])

            # Process pot
            if 'pot' in extracted_rois and 'image' in extracted_rois['pot']:
                pot_data = self.element_recognizer.recognize_pot(extracted_rois['pot']['image'])
                builder.set_pot(pot_data['amount'], pot_data['confidence'])

            # Process dealer button
            if 'button' in extracted_rois and 'image' in extracted_rois['button']:
                button_data = self.element_recognizer.detect_dealer_button(extracted_rois['button']['image'])
                if button_data['present']:
                    builder.set_buttons('BTN', button_data['confidence'])  # Placeholder position

            # Set positions confidence
            builder.set_positions(0.9)

            # Check for occlusions
            for roi_name, roi_data in extracted_rois.items():
                if 'image' in roi_data and 'roi' in roi_data:
                    is_occluded, occlusion_score = detect_occlusion(frame, roi_data['roi'])
                    if is_occluded:
                        builder.set_occlusion(roi_name, occlusion_score)

            # Set latency
            builder.set_latency(capture_time, extraction_time)

            # Build final output
            output = builder.build()

            # Convert to protobuf format (placeholder)
            # In real implementation, would create proper protobuf message
            return self._convert_to_protobuf(output)

        except Exception as e:
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f'Vision processing failed: {str(e)}')
            raise

    def _convert_to_protobuf(self, output_dict):
        """Convert output dict to protobuf message."""
        # Placeholder - would use generated protobuf classes
        # return vision_pb2.VisionOutput(**output_dict)
        return output_dict


def serve(port: int = 50052):
    """Start gRPC server."""
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))

    # Add service
    # vision_pb2_grpc.add_VisionServiceServicer_to_server(VisionServicer(), server)

    server.add_insecure_port(f'[::]:{port}')
    server.start()

    print(f"Vision service listening on port {port}")

    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        print("Shutting down vision service...")
        server.stop(0)


if __name__ == '__main__':
    # Initialize model manager (would load actual models)
    model_manager = ModelManager('services/vision/models/')
    serve()