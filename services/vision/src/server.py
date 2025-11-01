"""gRPC server for vision service."""
import json
import logging
import time
from concurrent import futures
import grpc

from . import capture
from . import extraction
from . import models
from . import element_recognizer
from . import confidence
from . import occlusion
from . import output
from . import gating

# Import generated protobuf code (would be generated via buf)
# For now, using placeholder structure
# import vision_pb2
# import vision_pb2_grpc

logger = logging.getLogger(__name__)


class VisionServicer:
    """gRPC servicer for vision service."""
    
    def __init__(self, model_manager: models.ModelManager):
        """
        Initialize vision servicer.
        
        Args:
            model_manager: ModelManager instance
        """
        self.model_manager = model_manager
        self.screen_capture = capture.ScreenCapture()
        self.recognizer = element_recognizer.ElementRecognizer(model_manager)
    
    def CaptureFrame(self, request, context):
        """
        Capture frame and extract game state.
        
        Args:
            request: CaptureRequest with layout_json
            context: gRPC context
        
        Returns:
            VisionOutput message
        """
        try:
            # Parse layout pack
            layout = json.loads(request.layout_json)
            
            # Build output
            builder = output.VisionOutputBuilder()
            
            # Capture frame
            frame = self.screen_capture.capture_frame()
            builder.mark_capture_complete()
            
            # Extract ROIs
            rois = extraction.extract_all_rois(frame, layout)
            builder.mark_extraction_complete()
            
            # Recognize elements
            hole_cards = []
            community_cards = []
            card_confs = []
            
            # Recognize cards
            for i in range(min(2, len(layout.get("cardROIs", [])))):
                roi_name = f"card_{i}"
                if roi_name in rois:
                    card_info = self.recognizer.recognize_card(rois[roi_name])
                    if card_info["rank"] != "?" and card_info["suit"] != "?":
                        hole_cards.append({
                            "rank": card_info["rank"],
                            "suit": card_info["suit"]
                        })
                        card_confs.append(card_info["confidence"])
            
            # Community cards
            for i in range(2, len(layout.get("cardROIs", []))):
                roi_name = f"card_{i}"
                if roi_name in rois:
                    card_info = self.recognizer.recognize_card(rois[roi_name])
                    if card_info["rank"] != "?" and card_info["suit"] != "?":
                        community_cards.append({
                            "rank": card_info["rank"],
                            "suit": card_info["suit"]
                        })
                        card_confs.append(card_info["confidence"])
            
            card_conf = confidence.aggregate_confidence(card_confs) if card_confs else 0.0
            builder.set_cards(hole_cards, community_cards, card_conf)
            
            # Recognize stacks
            for position, roi in layout.get("stackROIs", {}).items():
                roi_name = f"stack_{position}"
                if roi_name in rois:
                    stack_info = self.recognizer.recognize_stack(rois[roi_name])
                    builder.set_stack(position, stack_info["amount"], stack_info["confidence"])
            
            # Recognize pot
            if "pot" in rois:
                pot_info = self.recognizer.recognize_pot(rois["pot"])
                builder.set_pot(pot_info["amount"], pot_info["confidence"])
            
            # Detect dealer button
            if "button" in rois:
                button_info = self.recognizer.detect_dealer_button(rois["button"])
                # Infer button position (simplified)
                builder.set_buttons("BTN", button_info["confidence"])
            
            # Detect occlusion
            for roi_name, roi_img in rois.items():
                is_occ, occ_score = occlusion.detect_occlusion(roi_img, {})
                if is_occ:
                    builder.set_occlusion(roi_name, occ_score * 100.0)  # Convert to percentage
            
            builder.set_positions(0.9)  # Simplified
            
            # Build output
            output_dict = builder.build()
            
            # Convert to protobuf message (placeholder)
            # response = vision_pb2.VisionOutput(**output_dict)
            # return response
            
            # For now, return dict (would be converted to proto)
            return output_dict
        
        except Exception as e:
            logger.error(f"CaptureFrame failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            raise


def serve(port: int = 50052):
    """
    Start gRPC server.
    
    Args:
        port: Server port
    """
    # Initialize model manager
    model_dir = "services/vision/models"
    model_manager = models.ModelManager(model_dir)
    model_manager.preload_models()
    
    # Create server
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    
    # Add servicer (would use generated stub)
    # vision_pb2_grpc.add_VisionServiceServicer_to_server(
    #     VisionServicer(model_manager), server
    # )
    
    # Listen on port
    server.add_insecure_port(f"[::]:{port}")
    server.start()
    
    logger.info(f"Vision service started on port {port}")
    
    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        server.stop(0)
