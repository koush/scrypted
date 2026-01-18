from __future__ import annotations

import json
import random
import re
import asyncio
import math
import os
import socket
import traceback
import urllib.request
from typing import Any, List, Mapping, Tuple

import scrypted_sdk
from PIL import Image
from scrypted_sdk.types import (ObjectDetectionResult, ObjectDetectionSession,
                                ObjectsDetected, Setting)

import common.colors
from detect import DetectPlugin
from predict.rectangle import Rectangle

cache_dir = os.path.join(os.environ["SCRYPTED_PLUGIN_VOLUME"], "files", "hf")
# os.makedirs(cache_dir, exist_ok=True)
# os.environ['HF_HUB_CACHE'] = cache_dir

original_getaddrinfo = socket.getaddrinfo

# Sort the results to put IPv4 addresses first
# downloadFile uses socket.getaddrinfo to resolve the hostname
# which returns ipv6 first, causing issues on systems/networks with broken ipv6
# since it hangs forever.
# change the sort policy to use ipv4 first.
def custom_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    results = original_getaddrinfo(host, port, family, type, proto, flags)
    sorted_results = sorted(results, key=lambda x: (x[0] != socket.AF_INET, x[1]))
    return sorted_results
socket.getaddrinfo = custom_getaddrinfo

class Prediction:
    def __init__(self, id: int, score: float, bbox: Rectangle, embedding: str = None, clipPaths: List[List[Tuple[float, float]]] = None):
        # these may be numpy values. sanitize them.
        self.id = int(id)
        self.score = float(score)
        # ensure all floats from numpy
        self.bbox = Rectangle(
            float(bbox.xmin),
            float(bbox.ymin),
            float(bbox.xmax),
            float(bbox.ymax),
        )
        self.embedding = embedding
        self.clipPaths = clipPaths

class PredictPlugin(DetectPlugin, scrypted_sdk.ClusterForkInterface, scrypted_sdk.ScryptedSystemDevice, scrypted_sdk.DeviceCreator, scrypted_sdk.DeviceProvider):
    labels: dict

    def __init__(
        self,
        plugin: PredictPlugin = None,
        nativeId: str | None = None,
        forked: bool = False,
    ):
        super().__init__(nativeId=nativeId)

        self.periodic_restart = True

        self.systemDevice = {
            "deviceCreator": "Model",
        }

        self.plugin = plugin
        # self.clusterIndex = 0

        # periodic restart of main plugin because there seems to be leaks in tflite or coral API.
        if not nativeId:
            loop = asyncio.get_event_loop()
            loop.call_later(4 * 60 * 60, lambda: self.requestRestart())

        self.batch: List[Tuple[Any, asyncio.Future]] = []
        self.batching = 0
        self.batch_flush = None

        self.forked = forked
        if not self.forked:
            self.forks: Mapping[str, scrypted_sdk.PluginFork] = {}

        if not self.plugin and not self.forked:
            asyncio.ensure_future(self.startCluster(), loop=self.loop)

    def downloadHuggingFaceModel(self, model: str, local_files_only: bool = False) -> str:
        from huggingface_hub import snapshot_download
        plugin_suffix = self.pluginId.split('/')[1]
        local_dir = os.path.join(cache_dir, plugin_suffix, model)
        local_path = snapshot_download(
            repo_id="scrypted/plugin-models",
            allow_patterns=f"{plugin_suffix}/{model}/*",
            local_files_only=local_files_only,
            local_dir=local_dir,
        )
        local_path = os.path.join(local_path, plugin_suffix, model)
        return local_path

    def downloadHuggingFaceModelLocalFallback(self, model: str) -> str:
        try:
            local_path = self.downloadHuggingFaceModel(model)
            print("Downloaded/refreshed model:", model)
            return local_path
        except Exception:
            traceback.print_exc()

            print("Unable to download model:", model)
            print('This may be due to network or firewall issues.')

        print("Trying model from Hugging Face Hub (offline):", model)
        local_path = self.downloadHuggingFaceModel(model, local_files_only=True)
        return local_path

    def downloadFile(self, url: str, filename: str):
        try:
            filesPath = os.path.join(os.environ["SCRYPTED_PLUGIN_VOLUME"], "files")
            fullpath = os.path.join(filesPath, filename)
            if os.path.isfile(fullpath):
                print("File already exists", fullpath)
                return fullpath
            tmp = fullpath + ".tmp"
            print("Creating directory for", tmp)
            os.makedirs(os.path.dirname(fullpath), exist_ok=True)
            print("Downloading", url)
            response = urllib.request.urlopen(url)
            if response.getcode() < 200 or response.getcode() >= 300:
                raise Exception(f"non-2xx response code")
            read = 0
            with open(tmp, "wb") as f:
                while True:
                    data = response.read(1024 * 1024)
                    if not data:
                        break
                    read += len(data)
                    f.write(data)
            os.rename(tmp, fullpath)
            print("Downloaded", fullpath, read, "bytes")
            return fullpath
        except:
            traceback.print_exc()
            print("Error downloading", url)
            raise

    def getClasses(self) -> list[str]:
        return list(self.labels.values())

    def getTriggerClasses(self) -> list[str]:
        return ["motion"]

    def requestRestart(self):
        if self.periodic_restart:
            asyncio.ensure_future(scrypted_sdk.deviceManager.requestRestart())

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        pass

    def getModelSettings(self, settings: Any = None) -> list[Setting]:
        return []

    def get_input_format(self) -> str:
        return "rgb"

    def create_detection_result(
        self, objs: List[Prediction], size, convert_to_src_size=None
    ) -> ObjectsDetected:
        detections: List[ObjectDetectionResult] = []
        detection_result: ObjectsDetected = {}
        detection_result["detections"] = detections
        detection_result["inputDimensions"] = size

        for obj in objs:
            className = self.labels.get(obj.id, obj.id)
            detection: ObjectDetectionResult = {}
            detection["boundingBox"] = (
                obj.bbox.xmin,
                obj.bbox.ymin,
                obj.bbox.xmax - obj.bbox.xmin,
                obj.bbox.ymax - obj.bbox.ymin,
            )
            # check bounding box for nan
            if any(map(lambda x: not math.isfinite(x), detection["boundingBox"])):
                print("unexpected nan detected", obj.bbox)
                continue
            detection["className"] = className
            detection["score"] = obj.score
            if hasattr(obj, "embedding") and obj.embedding is not None:
                detection["embedding"] = obj.embedding
            if hasattr(obj, "clipPaths") and obj.clipPaths is not None and len(obj.clipPaths) > 0:
                detection["clipPaths"] = obj.clipPaths
            detections.append(detection)

        if convert_to_src_size:
            detections = detection_result["detections"]
            detection_result["detections"] = []
            for detection in detections:
                bb = detection["boundingBox"]
                x, y = convert_to_src_size((bb[0], bb[1]))
                x2, y2 = convert_to_src_size((bb[0] + bb[2], bb[1] + bb[3]))
                detection["boundingBox"] = (x, y, x2 - x + 1, y2 - y + 1)
                if any(map(lambda x: not math.isfinite(x), detection["boundingBox"])):
                    print("unexpected nan detected", obj.bbox)
                    continue
                # Transform clipPaths coordinates if present
                if "clipPaths" in detection and detection["clipPaths"] is not None:
                    clip_paths = detection["clipPaths"]
                    # Convert each polygon (list of [x, y] tuples) to source size
                    transformed = [[
                        (convert_to_src_size((pt[0], pt[1]))[0], convert_to_src_size((pt[0], pt[1]))[1])
                        for pt in polygon
                    ] for polygon in clip_paths]
                    detection["clipPaths"] = transformed
                detection_result["detections"].append(detection)

        # print(detection_result)
        return detection_result

    def get_detection_input_size(self, src_size):
        # signals to pipeline that any input size is fine
        # previous code used to resize to correct size and run detection that way.
        # new code will resize the frame and potentially do multiple passes.
        # this is useful for high quality thumbnails.
        return (None, None)

    def get_input_size(self) -> Tuple[int, int]:
        pass

    async def detect_once(
        self, input: Image.Image, settings: Any, src_size, cvss
    ) -> ObjectsDetected:
        pass

    async def detect_batch(self, inputs: List[Any]) -> List[Any]:
        pass

    async def run_batch(self):
        batch = self.batch
        self.batch = []
        self.batching = 0

        if len(batch):
            inputs = [x[0] for x in batch]
            try:
                results = await self.detect_batch(inputs)
                for i, result in enumerate(results):
                    batch[i][1].set_result(result)
            except Exception as e:
                for input in batch:
                    input[1].set_exception(e)

    async def flush_batch(self):
        self.batch_flush = None
        await self.run_batch()

    async def queue_batch(self, input: Any) -> List[Any]:
        future = asyncio.Future(loop=asyncio.get_event_loop())
        self.batch.append((input, future))
        if self.batching:
            self.batching = self.batching - 1
            if self.batching:
                # if there is any sort of error or backlog, .
                if not self.batch_flush:
                    self.batch_flush = self.loop.call_later(
                        0.5, lambda: asyncio.ensure_future(self.flush_batch())
                    )
                return await future
        await self.run_batch()
        return await future

    async def safe_detect_once(
        self, input: Image.Image, settings: Any, src_size, cvss
    ) -> ObjectsDetected:
        try:
            f = self.detect_once(input, settings, src_size, cvss)
            return await asyncio.wait_for(f, 60)
        except:
            traceback.print_exc()
            print("encountered an error while detecting. requesting plugin restart.")
            self.requestRestart()
            raise

    async def run_detection_image(
        self, image: scrypted_sdk.Image, detection_session: ObjectDetectionSession
    ) -> ObjectsDetected:
        settings = detection_session and detection_session.get("settings")
        batch = (detection_session and detection_session.get("batch")) or 0
        self.batching += batch

        iw, ih = image.width, image.height
        w, h = self.get_input_size()

        if w is None or h is None:
            resize = None
            w = image.width
            h = image.height

            def cvss(point):
                return point

        else:
            resize = None
            xs = w / iw
            ys = h / ih

            def cvss(point):
                return point[0] / xs, point[1] / ys

            if iw != w or ih != h:
                resize = {
                    "width": w,
                    "height": h,
                }

        format = image.format or self.get_input_format()

        # if the model requires yuvj444p, convert the image to yuvj444p directly
        # if possible, otherwise use whatever is available and convert in the detection plugin
        if self.get_input_format() == "yuvj444p":
            if image.ffmpegFormats != True:
                format = image.format or "rgb"

        if settings and settings.get("pad", False):
            if iw / w > ih / h:
                scale = w / iw
            else:
                scale = h / ih
            nw = int(iw * scale)
            nh = int(ih * scale)

            resize = {
                "width": nw,
                "height": nh,
            }

            b = await image.toBuffer(
                {
                    "resize": resize,
                    "format": format,
                }
            )

            if self.get_input_format() == "rgb":
                data = await common.colors.ensureRGBData(b, (nw, nh), format)
            elif self.get_input_format() == "rgba":
                data = await common.colors.ensureRGBAData(b, (nw, nh), format)
            elif self.get_input_format() == "yuvj444p":
                data = await common.colors.ensureYCbCrAData(b, (nw, nh), format)
            else:
                raise Exception("unsupported format")
            
            # data is a PIL image and we need to pad it to w, h
            new_image = Image.new(data.mode, (w, h))
            paste_x = (w - nw) // 2
            paste_y = (h - nh) // 2
            new_image.paste(data, (paste_x, paste_y))
            data.close()
            data = new_image

        else:
            b = await image.toBuffer(
                {
                    "resize": resize,
                    "format": format,
                }
            )

            if self.get_input_format() == "rgb":
                data = await common.colors.ensureRGBData(b, (w, h), format)
            elif self.get_input_format() == "rgba":
                data = await common.colors.ensureRGBAData(b, (w, h), format)
            elif self.get_input_format() == "yuvj444p":
                data = await common.colors.ensureYCbCrAData(b, (w, h), format)
            else:
                raise Exception("unsupported format")

        try:
            ret = await self.safe_detect_once(data, settings, (iw, ih), cvss)
            return ret
        finally:
            data.close()

    async def forkInterfaceInternal(self, options: dict):
        if self.plugin:
            return await self.plugin.forkInterfaceInternal(options)
        clusterWorkerId = options.get("clusterWorkerId", None)

        if not clusterWorkerId:
            raise Exception("clusterWorkerId required")

        if self.forked:
            raise Exception("cannot fork a fork")

        forked = self.forks.get(clusterWorkerId, None)
        if not forked:
            forked = scrypted_sdk.fork(
                {"labels": {"require": [self.pluginId]}, **(options or {})}
            )

            def clusterWorkerExit(result):
                print("cluster worker exit", clusterWorkerId)
                self.forks.pop(clusterWorkerId)

            forked.exit.add_done_callback(clusterWorkerExit)
            self.forks[clusterWorkerId] = forked

        result = await forked.result
        return result

    async def forkInterface(self, forkInterface, options: dict = None):
        if forkInterface != scrypted_sdk.ScryptedInterface.ObjectDetection.value:
            raise Exception("unsupported fork interface")

        result = await self.forkInterfaceInternal(options)
        if not self.nativeId:
            ret = await result.getPlugin()
        elif self.nativeId == "textrecognition":
            ret = await result.getTextRecognition()
        elif self.nativeId == "facerecognition":
            ret = await result.getFaceRecognition()
        elif self.nativeId == "clipembedding":
            ret = await result.getClipEmbedding()
        elif self.nativeId == "segmentation":
            ret = await result.getSegmentation()
        else:
            ret = await result.getCustomDetection(self.nativeId)
        return ret

    async def startCluster(self):
        try:
            clusterManager = scrypted_sdk.clusterManager
            if not clusterManager:
                return
            workers = await clusterManager.getClusterWorkers()
            thisClusterWorkerId = clusterManager.getClusterWorkerId()
        except:
            traceback.print_exc()
            return

        for cwid in workers:
            if cwid == thisClusterWorkerId:
                selfFork = Fork(None)
                selfFork.plugin = self

                pf = scrypted_sdk.PluginFork()
                pf.result = asyncio.Future(loop=self.loop)
                pf.result.set_result(selfFork)

                self.forks[cwid] = pf
                continue

            if self.pluginId not in workers[cwid]['labels']:
                print(f"not using cluster worker {workers[cwid]['name']} without label {self.pluginId}")
                continue

            async def startClusterWorker(clusterWorkerId=cwid):
                print("starting cluster worker", clusterWorkerId)
                try:
                    await self.forkInterfaceInternal(
                        {"clusterWorkerId": clusterWorkerId}
                    )
                except:
                    # traceback.print_exc()
                    pass

            asyncio.ensure_future(startClusterWorker(), loop=self.loop)


    async def getCreateDeviceSettings(self):
        ret: list[Setting] = []

        ret.append({
            "key": "name",
            "title": "Model Name",
            "description": "The name or description of this model. E.g., Bird Classifier."
        })

        ret.append({
            "key": "url",
            "title": "Model URL",
            "description": "The URL of the model. This should be a Github repo or url path to the model's config.json."
        })

        ret.append({
            "key": "info",
            "type": "html",
            "title": "Sample Model",
            "value": "<a href='https://github.com/scryptedapp/bird-classifier'>A reference bird classification model.</a>"
        })
        return ret

    async def createDevice(self, settings):
        name = settings.get('name', None)
        if not name:
            raise Exception("Model name not provided")
        model_url: str = settings.get('url', None)
        if not model_url:
            raise Exception("Model URL not provided")
        if not model_url.endswith('config.json'):
            plugin_suffix = self.pluginId.split('/')[1]
            match = re.match(r'https://github\.com/([^/]+)/([^/]+)', model_url)
            if not match:
                raise ValueError("Invalid GitHub repository URL.")
            
            org, repo = match.groups()
            model_url = f"https://raw.githubusercontent.com/{org}/{repo}/refs/heads/main/models/{plugin_suffix}/config.json"

        response = urllib.request.urlopen(model_url)
        if response.getcode() < 200 or response.getcode() >= 300:
            raise Exception(f"non-2xx response code")
        data = response.read()

        config = json.loads(data)

        nativeId = ''.join(random.choices('0123456789abcdef', k=8))

        id = await self.reportDevice(nativeId, name)

        from .custom_detect import CustomDetection
        device: CustomDetection = await self.getDevice(nativeId)
        device.storage.setItem("config_url", model_url)
        device.storage.setItem("config", json.dumps(config))
        device.init_model()

        return id
    
    async def reportDevice(self, nativeId: str, name: str):
        return await scrypted_sdk.deviceManager.onDeviceDiscovered(
            {
                "nativeId": nativeId,
                "type": scrypted_sdk.ScryptedDeviceType.Builtin.value,
                "interfaces": [
                    scrypted_sdk.ScryptedInterface.ClusterForkInterface.value,
                    scrypted_sdk.ScryptedInterface.ObjectDetection.value,
                    scrypted_sdk.ScryptedInterface.Settings.value,
                    "CustomObjectDetection",
                ],
                "name": name,
            },
        )

class Fork:
    def __init__(self, PluginType: Any):
        if PluginType:
            self.plugin = PluginType(forked=True)
        else:
            self.plugin = None

    async def getPlugin(self):
        return self.plugin

    async def getTextRecognition(self):
        return await self.plugin.getDevice("textrecognition")

    async def getFaceRecognition(self):
        return await self.plugin.getDevice("facerecognition")

    async def getClipEmbedding(self):
        return await self.plugin.getDevice("clipembedding")
    
    async def getSegmentation(self):
        return await self.plugin.getDevice("segmentation")

    async def getCustomDetection(self, nativeId: str):
        return await self.plugin.getDevice(nativeId)
