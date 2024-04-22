import asyncio
import concurrent.futures
import os
import platform
import queue
import threading
from typing import Any, Coroutine, List, Tuple
import urllib.request

import numpy as np
from PIL.Image import Image
from rknnlite.api import RKNNLite

from predict import PredictPlugin, Prediction
from predict.rectangle import Rectangle

# for Rockchip-optimized models, the postprocessing is slightly different from the original models
from .optimized.yolo import post_process, IMG_SIZE, CLASSES


rknn_verbose = False
lib_download = 'https://github.com/airockchip/rknn-toolkit2/raw/v2.0.0-beta0/rknpu2/runtime/Linux/librknn_api/aarch64/librknnrt.so'
model_download = 'https://github.com/bjia56/scrypted-rknn/raw/main/models/yolov6n_rk3588_optimized.rknn'
lib_path = '/usr/lib/librknnrt.so'


def ensure_compatibility():
    err_msg = 'RKNN plugin is only supported on Linux/ARM64 platform with RK3588(S) CPU'
    if platform.machine() != 'aarch64':
        raise RuntimeError(err_msg)

    if platform.system() != 'Linux':
        raise RuntimeError(err_msg)

    try:
        with open('/proc/device-tree/compatible') as f:
            if not 'rk3588' in f.read():
                raise RuntimeError(err_msg)
    except IOError as e:
        print('Failed to read /proc/device-tree/compatible: {}'.format(e))
        print('If you are running this on RK3588(S) via Docker, ensure you are launching the container with --privileged option')
        raise


class RKNNPlugin(PredictPlugin):
    labels = {i: CLASSES[i] for i in range(len(CLASSES))}
    rknn_runtimes: dict

    def __init__(self, nativeId=None):
        super().__init__(nativeId)
        ensure_compatibility()

        self.rknn_runtimes = {}

        if not os.path.exists(lib_path):
            installation = os.environ.get('SCRYPTED_INSTALL_ENVIRONMENT')
            if installation in ('docker', 'lxc'):
                print('Downloading librknnrt.so from {}'.format(lib_download))
                urllib.request.urlretrieve(lib_download, lib_path)
            else:
                raise RuntimeError('librknnrt.so not found. Please download it from {} and place it at {}'.format(lib_download, lib_path))

        model_path = self.downloadFile(model_download, os.path.basename(model_download))

        def executor_initializer():
            thread_name = threading.current_thread().name
            rknn = RKNNLite(verbose=rknn_verbose)
            ret = rknn.load_rknn(model_path)
            if ret != 0:
                raise RuntimeError('Failed to load model: {}'.format(ret))

            ret = rknn.init_runtime()
            if ret != 0:
                raise RuntimeError('Failed to init runtime: {}'.format(ret))

            self.rknn_runtimes[thread_name] = rknn
            print('RKNNLite runtime initialized on thread {}'.format(thread_name))

        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=3, initializer=executor_initializer)

    def get_input_details(self) -> Tuple[int]:
        return (IMG_SIZE[0], IMG_SIZE[1], 3)

    def get_input_size(self) -> Tuple[int, int]:
        return IMG_SIZE

    async def detect_once(self, input: Image, settings: Any, src_size, cvss) -> Coroutine[Any, Any, Any]:
        def inference(input_tensor):
            rknn = self.rknn_runtimes[threading.current_thread().name]
            outputs = rknn.inference(inputs=[input_tensor])
            return outputs

        async def predict(input_tensor):
            fut = asyncio.wrap_future(self.executor.submit(inference, input_tensor))
            outputs = await fut
            boxes, classes, scores = post_process(outputs)

            predictions: List[Prediction] = []
            for i in range(len(classes)):
                #print(CLASSES[classes[i]], scores[i])
                predictions.append(Prediction(
                    classes[i],
                    float(scores[i]),
                    Rectangle(float(boxes[i][0]), float(boxes[i][1]), float(boxes[i][2]), float(boxes[i][3]))
                ))

            return self.create_detection_result(predictions, src_size, cvss)
        input_tensor = np.expand_dims(np.asarray(input), axis=0)
        return await predict(input_tensor)
