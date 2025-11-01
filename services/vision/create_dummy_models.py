#!/usr/bin/env python3
"""Create dummy ONNX models for testing."""

import onnx
from onnx import helper, TensorProto
import numpy as np


def create_dummy_model(name: str, input_shape: list, output_shape: list, num_classes: int):
    """Create a simple dummy ONNX model."""
    # Input tensor
    input_tensor = helper.make_tensor_value_info('input', TensorProto.FLOAT, input_shape)

    # Output tensor
    output_tensor = helper.make_tensor_value_info('output', TensorProto.FLOAT, output_shape)

    # Dummy weights - random but deterministic
    np.random.seed(42)
    weight_shape = [num_classes] + input_shape[1:]  # [classes, channels, height, width]
    weights = np.random.randn(*weight_shape).astype(np.float32)

    # Create weight tensor
    weight_tensor = helper.make_tensor('weight', TensorProto.FLOAT, weight_shape, weights.flatten())

    # Create Conv node (very simple)
    conv_node = helper.make_node(
        'Conv',
        inputs=['input', 'weight'],
        outputs=['conv_output'],
        kernel_shape=[3, 3],
        pads=[1, 1, 1, 1]
    )

    # Global average pool
    pool_node = helper.make_node(
        'GlobalAveragePool',
        inputs=['conv_output'],
        outputs=['pool_output']
    )

    # Reshape to [batch_size, num_features]
    reshape_shape = np.array([0, -1], dtype=np.int64)  # 0 means keep batch dim, -1 infers
    reshape_tensor = helper.make_tensor('reshape_shape', TensorProto.INT64, [2], reshape_shape)
    reshape_node = helper.make_node(
        'Reshape',
        inputs=['pool_output', 'reshape_shape'],
        outputs=['reshaped']
    )

    # Dense layer weights
    dense_weight = np.random.randn(num_classes, weight_shape[1] * 3 * 3).astype(np.float32)
    dense_weight_tensor = helper.make_tensor('dense_weight', TensorProto.FLOAT, dense_weight.shape, dense_weight.flatten())

    dense_node = helper.make_node(
        'MatMul',
        inputs=['reshaped', 'dense_weight'],
        outputs=['dense_output']
    )

    # Softmax
    softmax_node = helper.make_node(
        'Softmax',
        inputs=['dense_output'],
        outputs=['output']
    )

    # Create graph
    graph = helper.make_graph(
        [conv_node, pool_node, reshape_node, dense_node, softmax_node],
        f'{name}_model',
        [input_tensor],
        [output_tensor],
        [weight_tensor, reshape_tensor, dense_weight_tensor]
    )

    # Create model
    model = helper.make_model(graph, producer_name=f'{name}_model')
    onnx.checker.check_model(model)

    return model


def main():
    """Create all dummy models."""
    # Card rank model (13 classes: 2-A)
    rank_model = create_dummy_model('card_rank', [1, 3, 64, 64], [1, 13], 13)
    onnx.save(rank_model, 'services/vision/models/card_rank.onnx')

    # Card suit model (4 classes: h,d,c,s)
    suit_model = create_dummy_model('card_suit', [1, 3, 64, 64], [1, 4], 4)
    onnx.save(suit_model, 'services/vision/models/card_suit.onnx')

    # Digit model (11 classes: 0-9 + decimal)
    digit_model = create_dummy_model('digit', [1, 3, 64, 64], [1, 11], 11)
    onnx.save(digit_model, 'services/vision/models/digit.onnx')

    print("Dummy ONNX models created successfully!")


if __name__ == '__main__':
    main()