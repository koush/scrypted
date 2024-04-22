import asyncio
import os
import platform
from typing import Any, Coroutine, List, Tuple
import urllib.request

import numpy as np
from PIL.Image import Image
from rknnlite.api import RKNNLite

from predict import PredictPlugin, Prediction
from predict.rectangle import Rectangle

import scrypted_sdk
from scrypted_sdk import MediaObject, ObjectDetectionSession, ObjectDetectionGeneratorSession, ObjectDetectionGeneratorResult, ObjectDetectionModel, ObjectsDetected, VideoFrame

# for Rockchip-optimized models, the postprocessing is slightly different from the original models
from .optimized.yolo import post_process, IMG_SIZE, LABELS

import time


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


class RKNNInference:
    model_path: str
    rknn: RKNNLite

    def __init__(self, model_path: str) -> None:
        self.model_path = model_path
        self.init_rknn()

    def init_rknn(self) -> None:
        self.rknn = RKNNLite(verbose=rknn_verbose)
        ret = self.rknn.load_rknn(self.model_path)
        if ret != 0:
            raise RuntimeError('Failed to load model: {}'.format(ret))

        ret = self.rknn.init_runtime()
        if ret != 0:
            raise RuntimeError('Failed to init runtime: {}'.format(ret))

    def inference(self, input_tensor: list) -> list:
        start = time.time()
        input_tensor = np.array(input_tensor).astype(np.int8)
        print(f'input_tensor: {time.time() - start}')
        start = time.time()
        result = self.rknn.inference(inputs=[input_tensor])
        print(f'inference: {time.time() - start}')
        start = time.time()
        for i in range(len(result)):
            print(result[i].size)
            result[i] = result[i].tolist()
        print(f'to list: {time.time() - start}')
        return result


class RKNNDetector(PredictPlugin):
    labels = LABELS
    model_path: str
    inference: RKNNInference

    def __init__(self, inference: RKNNInference = None) -> None:
        super().__init__()
        asyncio.get_event_loop().create_task(self.async_init(inference))

    async def async_init(self, inference: RKNNInference) -> None:
        self.inference = await scrypted_sdk.sdk.connectRPCObject(inference)

    def get_input_details(self) -> Tuple[int]:
        return (IMG_SIZE[0], IMG_SIZE[1], 3)

    def get_input_size(self) -> Tuple[int, int]:
        return IMG_SIZE

    async def detect_once(self, input: Image, settings: Any, src_size, cvss) -> Coroutine[Any, Any, Any]:
        input_tensor = np.expand_dims(np.asarray(input), axis=0).tolist()
        start = time.time()
        outputs = await self.inference.inference(input_tensor)
        print(f'inference: {time.time() - start}')
        for i in range(len(outputs)):
            outputs[i] = np.array(outputs[i]).astype(np.float32)
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


class RKNNPlugin(PredictPlugin):
    model_path: str
    executors: asyncio.Queue
    num_forks: int = 8
    inference: RKNNInference

    def __init__(self, nativeId=None) -> None:
        super().__init__(nativeId)
        ensure_compatibility()

        if not os.path.exists(lib_path):
            print('Downloading librknnrt.so from {}'.format(lib_download))
            urllib.request.urlretrieve(lib_download, lib_path)

        self.model_path = self.downloadFile(model_download, os.path.basename(model_download))

        self.executors = asyncio.Queue()
        asyncio.get_event_loop().create_task(self.async_init())

    async def async_init(self) -> None:
        f = await scrypted_sdk.fork().result
        self.inference = await f.get_inference(self.model_path)

        for _ in range(self.num_forks):
            f = await scrypted_sdk.fork().result
            self.executors.put_nowait(await f.get_detector(self.inference))

    async def detectObjects(self, mediaObject: MediaObject, session: ObjectDetectionSession = None) -> ObjectsDetected:
        start = time.time()
        executor = await self.executors.get()
        try:
            return await executor.detectObjects(mediaObject, session)
        except Exception as e:
            print(f'Executor failed: {e}')
            print('Requesting restart...')
            await scrypted_sdk.deviceManager.requestRestart()
        finally:
            print(f'Elapsed: {time.time() - start}')
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


class RKNNFork:
    def get_inference(self, model_path: str) -> RKNNInference:
        return RKNNInference(model_path)

    def get_detector(self, inference: RKNNInference) -> RKNNDetector:
        return RKNNDetector(inference)


async def fork() -> RKNNFork:
    return RKNNFork()