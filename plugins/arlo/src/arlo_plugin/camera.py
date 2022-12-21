import asyncio
import json
import threading

import scrypted_sdk
from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import Camera, VideoCamera, Intercom, MotionSensor, Battery, DeviceProvider, ScryptedDevice, ScryptedMimeTypes, ScryptedInterface, ScryptedDeviceType

from .logging import ScryptedDeviceLoggerMixin

class ArloCamera(ScryptedDeviceBase, Camera, VideoCamera, Intercom, MotionSensor, Battery, DeviceProvider, ScryptedDeviceLoggerMixin):
    timeout = 30
    nativeId = None
    arlo_device = None
    arlo_basestation = None
    provider = None

    def __init__(self, nativeId, arlo_device, arlo_basestation, provider):
        super().__init__(nativeId=nativeId)

        this_class = type(self)
        self.logger_name = f"{this_class.__name__}[{nativeId}]"

        self.nativeId = nativeId
        self.arlo_device = arlo_device
        self.arlo_basestation = arlo_basestation
        self.provider = provider
        self.logger.setLevel(self.provider.get_current_log_level())
        
        self._update_device_details(arlo_device)

        self.stop_subscriptions = False
        self.start_motion_subscription()
        self.start_battery_subscription()

        self.speaker = None
        asyncio.get_event_loop().create_task(self.discoverDevices())

    def __del__(self):
        self.stop_subscriptions = True

    def start_motion_subscription(self):
        def callback(motionDetected):
            self.motionDetected = motionDetected
            return self.stop_subscriptions

        self.provider.arlo.SubscribeToMotionEvents(self.arlo_basestation, self.arlo_device, callback)

    def start_battery_subscription(self):
        def callback(batteryLevel):
            self.batteryLevel = batteryLevel
            return self.stop_subscriptions

        self.provider.arlo.SubscribeToBatteryEvents(self.arlo_basestation, self.arlo_device, callback)

    async def getPictureOptions(self):
        return []

    async def takePicture(self, options=None):
        self.logger.info("Taking picture")

        real_device = await scrypted_sdk.systemManager.api.getDeviceById(self.getScryptedProperty("id"))
        msos = await real_device.getVideoStreamOptions()
        if any(["prebuffer" in m for m in msos]):
            self.logger.info("Getting snapshot from prebuffer")
            return await real_device.getVideoStream({"refresh": False})

        pic_url = await asyncio.wait_for(self.provider.arlo.TriggerFullFrameSnapshot(self.arlo_basestation, self.arlo_device), timeout=self.timeout)
        self.logger.debug(f"Got snapshot URL for at {pic_url}")

        if pic_url is None:
            raise Exception("Error taking snapshot")

        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(pic_url), ScryptedMimeTypes.Url.value)

    async def getVideoStreamOptions(self):
        return [
            {
                "id": 'default',
                "name": 'Cloud RTSP',
                "container": 'rtsp',
                "video": {
                    "codec": 'h264',
                },
                "audio": None if self.arlo_device.get("modelId") == "VMC3030" else {
                    "codec": 'aac',
                },
                "source": 'cloud',
                "tool": 'scrypted',
                "userConfigurable": False,
            }
        ]

    async def getVideoStream(self, options=None):
        self.logger.info("Requesting stream")

        rtsp_url = await asyncio.wait_for(self.provider.arlo.StartStream(self.arlo_basestation, self.arlo_device), timeout=self.timeout)
        self.logger.debug(f"Got stream URL at {rtsp_url}")

        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(rtsp_url), ScryptedMimeTypes.Url.value)

    async def discoverDevices(self, duration=0):
        self.speaker = None

        speaker_device = {
            "nativeId": f"{self.nativeId}.speaker",
            "name": f"{self.arlo_device['deviceName']} Speaker",
            "interfaces": [
                ScryptedInterface.ScryptedDevice.value,
                ScryptedInterface.RTCSignalingChannel.value,
            ],
            "type": ScryptedDeviceType.Speaker.value,
            "providerNativeId": self.nativeId,
        }
        await scrypted_sdk.deviceManager.onDevicesChanged({
            "devices": [speaker_device],
            "providerNativeId": self.nativeId,
        })

    def getDevice(self, nativeId):
        if self.speaker is None:
            self.speaker = ArloCameraSpeaker(nativeId, self.arlo_device, self.arlo_basestation, self.provider)
        return self.speaker

    async def startIntercom(self, media):
        self.logger.info("Starting intercom")
        real_speaker = await self.speaker.real_speaker()
        await real_speaker.startIntercom(media)
        self.logger.info("STARTED")

    async def stopIntercom(self):
        self.logger.info("Stopping intercom")
        real_speaker = await self.speaker.real_speaker()
        await real_speaker.stopIntercom()
        self.logger.info("STOPPED")

    def _update_device_details(self, arlo_device):
        """For updating device details from the Arlo dictionary retrieved from Arlo's REST API.
        """
        self.batteryLevel = arlo_device["properties"].get("batteryLevel")

class ArloCameraSpeaker(ScryptedDeviceBase, ScryptedDevice, ScryptedDeviceLoggerMixin):
    def __init__(self, nativeId, arlo_device, arlo_basestation, provider):
        super().__init__(nativeId=nativeId)

        this_class = type(self)
        self.logger_name = f"{this_class.__name__}[{nativeId}]"

        self.nativeId = nativeId
        self.arlo_device = arlo_device
        self.arlo_basestation = arlo_basestation
        self.provider = provider
        self.logger.setLevel(self.provider.get_current_log_level())

        self.stop_subscriptions = False
        self.start_sdp_answer_subscription()
        self.start_candidate_answer_subscription()

        self.rtc_session = None
        self.rtc_setup = None

    def __del__(self):
        self.stop_subscriptions = True

    def start_sdp_answer_subscription(self):
        def callback(sdp):
            if self.rtc_session:
                self.logger.info(f"Arlo response sdp: {sdp}")
                asyncio.get_event_loop().create_task(self.rtc_session.setRemoteDescription(
                    { "sdp": sdp, "type": "answer" },
                    self.rtc_setup
                ))
            return self.stop_subscriptions

        self.provider.arlo.SubscribeToSDPAnswers(self.arlo_basestation, self.arlo_device, callback)

    def start_candidate_answer_subscription(self):
        def callback(candidate):
            if self.rtc_session:
                prefix = "a=candidate:"
                if candidate.startswith(prefix):
                    candidate = candidate[len(prefix):]
                self.logger.info(f"Arlo response candidate: {candidate}")
                asyncio.get_event_loop().create_task(self.rtc_session.addIceCandidate(
                    { "candidate": candidate }
                ))
            return self.stop_subscriptions

        self.provider.arlo.SubscribeToCandidateAnswers(self.arlo_basestation, self.arlo_device, callback)

    async def startRTCSignalingSession(self, session):
        self.logger.info("Starting RTC signaling")

        self.rtc_session = session
        session_id, ice_servers = self.provider.arlo.StartPushToTalk(self.arlo_basestation, self.arlo_device)

        self.rtc_setup = {
            "type": "offer",
            "audio": {
                "direction": "sendonly",
            },
            "configuration": {
                "iceServers": [
                    dict(urls=ice["url"], credential=ice.get("credential"), username=ice.get("username"))
                    for ice in ice_servers
                ]
            },
        }

        async def on_ice_candidate(candidate):
            self.logger.info(f"Arlo offer candidate: {candidate.candidate}")
            self.provider.arlo.NotifyPushToTalkCandidate(self.arlo_basestation, self.arlo_device, session_id, candidate.candidate)

        offer = await session.createLocalDescription("offer", self.rtc_setup, on_ice_candidate)
        self.logger.info(f"Arlo offer sdp: {offer.sdp}")

        self.provider.arlo.NotifyPushToTalkSDP(self.arlo_basestation, self.arlo_device, session_id, offer.sdp)

        return ArloCameraSpeakerSessionControl(self)

    async def real_speaker(self):
        return await scrypted_sdk.systemManager.api.getDeviceById(self.getScryptedProperty("id"))

    def close(self):
        self.rtc_session = None
        self.rtc_setup = None

class ArloCameraSpeakerSessionControl:
    def __init__(self, speaker):
        self.speaker = speaker

    async def endSession(self):
        self.speaker.close()