import asyncio
import concurrent.futures
import os
import platform
import queue
from typing import Any, Coroutine, List, Tuple
import urllib.request

import numpy as np
from PIL.Image import Image
from rknnlite.api import RKNNLite

from predict import PredictPlugin, Prediction
from predict.rectangle import Rectangle

import scrypted_sdk
from scrypted_sdk import ScryptedDeviceBase, ObjectDetection, MediaObject, ObjectDetectionSession, ObjectDetectionGeneratorSession, ObjectDetectionGeneratorResult, ObjectDetectionModel, ObjectsDetected, VideoFrame

# for Rockchip-optimized models, the postprocessing is slightly different from the original models
from .optimized.yolo import post_process, IMG_SIZE, LABELS


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


def thread_executor_main(model_path, core_num, core_mask, job_queue: queue.Queue):
    rknn = RKNNLite(verbose=rknn_verbose)
    ret = rknn.load_rknn(model_path)
    if ret != 0:
        raise RuntimeError('Failed to load model: {}'.format(ret))

    ret = rknn.init_runtime(core_mask=core_mask)
    if ret != 0:
        raise RuntimeError('Failed to init runtime: {}'.format(ret))

    print('RKNNLite runtime initialized on core {}'.format(core_num))

    while True:
        input_tensor, done_future = job_queue.get()

        # check for shutdown
        if input_tensor is None:
            break

        outputs = rknn.inference(inputs=[input_tensor])
        done_future.set_result(outputs)


class RKNNPlugin(PredictPlugin):
    labels = LABELS
    rknn: RKNNLite
    model_path: str

    def __init__(self, nativeId=None):
        super().__init__(nativeId)

        if not os.path.exists(lib_path):
            print('Downloading librknnrt.so from {}'.format(lib_download))
            urllib.request.urlretrieve(lib_download, lib_path)

        self.model_path = self.downloadFile(model_download, os.path.basename(model_download))

    def init_rknn(self, core_mask: int) -> None:
        self.rknn = RKNNLite(verbose=rknn_verbose)
        ret = self.rknn.load_rknn(self.model_path)
        if ret != 0:
            raise RuntimeError('Failed to load model: {}'.format(ret))

        ret = self.rknn.init_runtime(core_mask=core_mask)
        if ret != 0:
            raise RuntimeError('Failed to init runtime: {}'.format(ret))

    def get_input_details(self) -> Tuple[int]:
        return (IMG_SIZE[0], IMG_SIZE[1], 3)

    def get_input_size(self) -> Tuple[int, int]:
        return IMG_SIZE

    async def detect_once(self, input: Image, settings: Any, src_size, cvss) -> Coroutine[Any, Any, Any]:
        input_tensor = np.expand_dims(np.asarray(input), axis=0)

        outputs = self.rknn.inference(inputs=[input_tensor])
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


class RKNNPluginProxy(ScryptedDeviceBase, ObjectDetection):
    executors: asyncio.Queue

    def __init__(self, nativeId=None) -> None:
        super().__init__(nativeId)
        ensure_compatibility()

        self.executors = asyncio.Queue()
        asyncio.get_event_loop().create_task(self.async_init())

    async def async_init(self) -> None:
        npu_0 = await scrypted_sdk.fork().result
        await npu_0.init_rknn(RKNNLite.NPU_CORE_0)
        npu_1 = await scrypted_sdk.fork().result
        await npu_1.init_rknn(RKNNLite.NPU_CORE_1)
        npu_2 = await scrypted_sdk.fork().result
        await npu_2.init_rknn(RKNNLite.NPU_CORE_2)

        self.executors.put_nowait(npu_0)
        self.executors.put_nowait(npu_1)
        self.executors.put_nowait(npu_2)

    async def detectObjects(self, mediaObject: MediaObject, session: ObjectDetectionSession = None) -> ObjectsDetected:
        executor = await self.executors.get()
        try:
            return await executor.detectObjects(mediaObject, session)
        except Exception as e:
            print(f'Executor failed: {e}')
            print('Requesting restart...')
            await scrypted_sdk.deviceManager.requestRestart()
        finally:
            self.executors.put_nowait(executor)
        pass

    async def generateObjectDetections(self, videoFrames: MediaObject | VideoFrame, session: ObjectDetectionGeneratorSession) -> ObjectDetectionGeneratorResult:
        executor = await self.executors.get()
        try:
            return await executor.generateObjectDetections(videoFrames, session)
        except Exception as e:
            print(f'Executor failed: {e}')
            print('Requesting restart...')
            await scrypted_sdk.deviceManager.requestRestart()
        finally:
            self.executors.put_nowait(executor)

    async def getDetectionModel(self, settings: Any = None) -> ObjectDetectionModel:
        executor = await self.executors.get()
        try:
            return await executor.getDetectionModel(settings)
        except Exception as e:
            print(f'Executor failed: {e}')
            print('Requesting restart...')
            await scrypted_sdk.deviceManager.requestRestart()
        finally:
            self.executors.put_nowait(executor)
