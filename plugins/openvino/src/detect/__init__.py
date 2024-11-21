from __future__ import annotations

import asyncio
from typing import Any, Tuple

import scrypted_sdk
from scrypted_sdk.types import (
    MediaObject,
    ObjectDetection,
    ObjectDetectionGeneratorSession,
    ObjectDetectionModel,
    ObjectDetectionSession,
    ObjectsDetected,
    ScryptedMimeTypes,
    Setting,
)


class DetectPlugin(
    scrypted_sdk.ScryptedDeviceBase,
    ObjectDetection,
):
    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)
        self.loop = asyncio.get_event_loop()
        self.modelName = self.pluginId

    def getClasses(self) -> list[str]:
        pass

    def getTriggerClasses(self) -> list[str]:
        pass

    def get_input_details(self) -> Tuple[int, int, int]:
        pass

    def get_input_format(self) -> str:
        pass

    def getModelSettings(self, settings: Any = None) -> list[Setting]:
        return []

    async def getDetectionModel(self, settings: Any = None) -> ObjectDetectionModel:
        d: ObjectDetectionModel = {
            "name": self.modelName,
            "classes": self.getClasses(),
            "triggerClasses": self.getTriggerClasses(),
            "inputSize": self.get_input_details(),
            "inputFormat": self.get_input_format(),
            "settings": [],
        }

        d["settings"] += self.getModelSettings(settings)

        return d

    def get_detection_input_size(self, src_size):
        pass

    async def run_detection_image(
        self, videoFrame: scrypted_sdk.Image, detection_session: ObjectDetectionSession
    ) -> ObjectsDetected:
        pass

    async def generateObjectDetections(
        self, videoFrames: Any, session: ObjectDetectionGeneratorSession = None
    ) -> Any:
        try:
            videoFrames = await scrypted_sdk.sdk.connectRPCObject(videoFrames)
            videoFrame: scrypted_sdk.VideoFrame
            async for videoFrame in videoFrames:
                image = await scrypted_sdk.sdk.connectRPCObject(videoFrame["image"])
                detected = await self.run_detection_image(image, session)
                yield {
                    "__json_copy_serialize_children": True,
                    "detected": detected,
                    "videoFrame": videoFrame,
                }
        finally:
            try:
                await videoFrames.aclose()
            except:
                pass

    async def detectObjects(
        self, mediaObject: MediaObject, session: ObjectDetectionSession = None
    ) -> ObjectsDetected:
        image: scrypted_sdk.Image
        if mediaObject.mimeType == ScryptedMimeTypes.Image.value:
            image = await scrypted_sdk.sdk.connectRPCObject(mediaObject)
        else:
            image = await scrypted_sdk.mediaManager.convertMediaObjectToBuffer(
                mediaObject, ScryptedMimeTypes.Image.value
            )

        return await self.run_detection_image(image, session)
