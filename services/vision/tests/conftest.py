"""Shared test fixtures for the vision service test suite."""

import numpy as np
import pytest


@pytest.fixture
def sample_roi_image():
    """A simple 30x50 BGR image for ROI testing."""
    return np.full((30, 50, 3), 128, dtype=np.uint8)


@pytest.fixture
def sample_template(sample_roi_image):
    """A template image identical to the sample ROI."""
    return sample_roi_image.copy()
