# Lint as: python3
# Copyright 2019 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Functions to work with any model."""

import numpy as np


def output_tensor(interpreter, i):
  """Gets a model's ith output tensor.
  Args:
    interpreter: The ``tf.lite.Interpreter`` holding the model.
    i (int): The index position of an output tensor.
  Returns:
    The output tensor at the specified position.
  """
  return interpreter.tensor(interpreter.get_output_details()[i]['index'])()


def input_details(interpreter, key):
  """Gets a model's input details by specified key.
  Args:
    interpreter: The ``tf.lite.Interpreter`` holding the model.
    key (int): The index position of an input tensor.
  Returns:
    The input details.
  """
  return interpreter.get_input_details()[0][key]


def input_size(interpreter):
  """Gets a model's input size as (width, height) tuple.
  Args:
    interpreter: The ``tf.lite.Interpreter`` holding the model.
  Returns:
    The input tensor size as (width, height) tuple.
  """
  _, height, width, _ = input_details(interpreter, 'shape')
  return width, height


def input_tensor(interpreter):
  """Gets a model's input tensor view as numpy array of shape (height, width, 3).
  Args:
    interpreter: The ``tf.lite.Interpreter`` holding the model.
  Returns:
    The input tensor view as :obj:`numpy.array` (height, width, 3).
  """
  tensor_index = input_details(interpreter, 'index')
  return interpreter.tensor(tensor_index)()[0]


def set_input(interpreter, data):
  """Copies data to a model's input tensor.
  Args:
    interpreter: The ``tf.lite.Interpreter`` to update.
    data: The input tensor.
  """
  input_tensor(interpreter)[:, :] = data


def set_resized_input(interpreter, size, resize):
  """Copies a resized and properly zero-padded image to a model's input tensor.
  Args:
    interpreter: The ``tf.lite.Interpreter`` to update.
    size (tuple): The original image size as (width, height) tuple.
    resize: A function that takes a (width, height) tuple, and returns an
      image resized to those dimensions.
  Returns:
    The resized tensor with zero-padding as tuple
    (resized_tensor, resize_ratio).
  """
  width, height = input_size(interpreter)
  w, h = size
  scale = min(width / w, height / h)
  w, h = int(w * scale), int(h * scale)
  tensor = input_tensor(interpreter)
  tensor.fill(0)  # padding
  _, _, channel = tensor.shape
  result = resize((w, h))
  tensor[:h, :w] = np.reshape(result, (h, w, channel))
  return result, (scale, scale)