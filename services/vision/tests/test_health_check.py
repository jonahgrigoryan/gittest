"""Tests for the vision service gRPC health check (Task 8.3a)."""

from __future__ import annotations

import os
import socket
from unittest.mock import MagicMock, patch

import grpc

from vision.models import ModelManager
from vision.server import VisionServicer, serve
from vision.templates import TemplateManager
from vision import vision_pb2
from vision import vision_pb2_grpc


def _mock_model_manager() -> MagicMock:
    mm = MagicMock(spec=ModelManager)
    mm.preload_models.return_value = None
    return mm


def _make_servicer(*, ready: bool = True) -> VisionServicer:
    return VisionServicer(
        _mock_model_manager(),
        template_manager=TemplateManager(layout_pack_file=None),
        ready=ready,
    )


def _get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


class TestHealthCheckSuccess:
    """HealthCheck returns healthy when service is ready."""

    def test_health_check_returns_healthy(self) -> None:
        servicer = _make_servicer(ready=True)
        context = MagicMock()

        response = servicer.HealthCheck(vision_pb2.Empty(), context)

        assert response.healthy is True
        assert response.message == "ready"

    def test_health_check_does_not_abort(self) -> None:
        servicer = _make_servicer(ready=True)
        context = MagicMock()

        servicer.HealthCheck(vision_pb2.Empty(), context)

        context.abort.assert_not_called()


class TestHealthCheckFailure:
    """HealthCheck returns unhealthy when service is not ready."""

    def test_health_check_returns_unhealthy_when_not_ready(self) -> None:
        servicer = _make_servicer(ready=False)
        context = MagicMock()

        response = servicer.HealthCheck(vision_pb2.Empty(), context)

        assert response.healthy is False
        assert response.message == "not ready"

    def test_serve_with_bad_layout_pack_starts_unhealthy(
        self, tmp_path: object
    ) -> None:
        """serve() with a bad layout pack responds unhealthy via gRPC."""
        env_overrides = {
            "VISION_LAYOUT_PACK": "nonexistent.layout.json",
        }
        port = _get_free_port()
        with patch.dict(os.environ, env_overrides):
            server = serve(
                port=port,
                model_dir=str(tmp_path),
                layout_pack_dir=str(tmp_path),
            )
            try:
                with grpc.insecure_channel(f"127.0.0.1:{port}") as channel:
                    stub = vision_pb2_grpc.VisionServiceStub(channel)
                    response = stub.HealthCheck(vision_pb2.Empty(), timeout=2.0)

                assert response.healthy is False
                assert response.message == "not ready"
            finally:
                server.stop(grace=0)
