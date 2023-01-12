from aioice import Candidate
from aiortc import RTCSessionDescription, RTCIceGatherer, RTCIceServer
from aiortc.rtcicetransport import candidate_to_aioice, candidate_from_aioice 
import asyncio
import json

import scrypted_sdk
from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import Camera, VideoCamera, Intercom, MotionSensor, Battery, ScryptedMimeTypes

from .logging import ScryptedDeviceLoggerMixin
from .util import BackgroundTaskMixin
from .rtcpeerconnection import BackgroundRTCPeerConnection


class ArloCamera(ScryptedDeviceBase, Camera, VideoCamera, Intercom, MotionSensor, Battery, ScryptedDeviceLoggerMixin, BackgroundTaskMixin):
    timeout = 30
    nativeId = None
    arlo_device = None
    arlo_basestation = None
    provider = None

    def __init__(self, nativeId, arlo_device, arlo_basestation, provider):
        super().__init__(nativeId=nativeId)

        self.logger_name = f"{nativeId}.camera"

        self.nativeId = nativeId
        self.arlo_device = arlo_device
        self.arlo_basestation = arlo_basestation
        self.provider = provider
        self.logger.setLevel(self.provider.get_current_log_level())
        
        self._update_device_details(arlo_device)

        self.stop_subscriptions = False
        self.start_motion_subscription()
        self.start_battery_subscription()

        self.pc = None
        self.sdp_answered = False
        self.start_sdp_answer_subscription()
        self.start_candidate_answer_subscription()

    def __del__(self):
        self.stop_subscriptions = True

    def start_motion_subscription(self):
        def callback(motionDetected):
            self.motionDetected = motionDetected
            return self.stop_subscriptions

        self.register_task(
            self.provider.arlo.SubscribeToMotionEvents(self.arlo_basestation, self.arlo_device, callback)
        )

    def start_battery_subscription(self):
        def callback(batteryLevel):
            self.batteryLevel = batteryLevel
            return self.stop_subscriptions

        self.register_task(
            self.provider.arlo.SubscribeToBatteryEvents(self.arlo_basestation, self.arlo_device, callback)
        )

    def start_sdp_answer_subscription(self):
        def callback(sdp):
            if self.pc and not self.sdp_answered:
                if "a=mid:" not in sdp:
                    # arlo appears to not return a mux id in the response, which
                    # doesn't play nicely with our webrtc peers. let's add it
                    sdp += "a=mid:0\r\n"
                self.logger.info(f"Arlo response sdp:\n{sdp}")

                sdp = RTCSessionDescription(sdp=sdp, type="answer")
                self.create_task(self.pc.setRemoteDescription(sdp))
                self.sdp_answered = True
            return self.stop_subscriptions

        self.register_task(
            self.provider.arlo.SubscribeToSDPAnswers(self.arlo_basestation, self.arlo_device, callback)
        )

    def start_candidate_answer_subscription(self):
        def callback(candidate):
            if self.pc:
                prefix = "a=candidate:"
                if candidate.startswith(prefix):
                    candidate = candidate[len(prefix):]
                candidate = candidate.strip()
                self.logger.info(f"Arlo response candidate: {candidate}")

                candidate = candidate_from_aioice(Candidate.from_sdp(candidate))
                if candidate.sdpMid is None:
                    # arlo appears to not return a mux id in the response, which
                    # doesn't play nicely with aiortc. let's add it
                    candidate.sdpMid = 0
                self.create_task(self.pc.addIceCandidate(candidate))
            return self.stop_subscriptions

        self.register_task(
            self.provider.arlo.SubscribeToCandidateAnswers(self.arlo_basestation, self.arlo_device, callback)
        )

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

    async def startIntercom(self, media):
        self.logger.info("Starting intercom")

        ffmpeg_params = json.loads(await scrypted_sdk.mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput.value))
        self.logger.debug(f"Received ffmpeg params: {ffmpeg_params}")

        options = {}
        current_key = None
        for arg in ffmpeg_params["inputArguments"]:
            if current_key is None and not arg.startswith("-"):
                self.logger.warning(f"Ignoring unknown ffmpeg argument {arg}")
                continue
            if arg.startswith("-"):
                current_key = arg.lstrip("-")
                options[current_key] = ""
                continue
            options[current_key] = (options[current_key] + " " + arg).strip()

        self.logger.debug(f"Parsed ffmpeg params: {options}")

        session_id, ice_servers = self.provider.arlo.StartPushToTalk(self.arlo_basestation, self.arlo_device)
        self.logger.debug(f"Received ice servers: {[ice['url'] for ice in ice_servers]}")
        
        ice_servers = [
            RTCIceServer(urls=ice["url"], credential=ice.get("credential"), username=ice.get("username"))
            for ice in ice_servers
        ]
        ice_gatherer = RTCIceGatherer(ice_servers)
        await ice_gatherer.gather()

        local_candidates = [
            f"candidate:{Candidate.to_sdp(candidate_to_aioice(candidate))}"
            for candidate in ice_gatherer.getLocalCandidates()
        ]

        log_candidates = '\n'.join(local_candidates)
        self.logger.info(f"Local candidates:\n{log_candidates}")

        # MediaPlayer/PyAV will block until the intercom stream starts, and it seems that scrypted waits
        # for startIntercom to exit before sending data. So, let's do the remaining setup in a coroutine
        # so this function can return early.
        # This is required even if we use BackgroundRTCPeerConnection, since setting up MediaPlayer may
        # block the background thread's event loop and prevent other async functions from running.
        async def async_setup():
            pc = self.pc = BackgroundRTCPeerConnection()
            self.sdp_answered = False

            await pc.add_audio(options)

            offer = await pc.createOffer()
            self.logger.info(f"Arlo offer sdp:\n{offer.sdp}")

            await pc.setLocalDescription(offer)

            self.provider.arlo.NotifyPushToTalkSDP(
                self.arlo_basestation, self.arlo_device,
                session_id, offer.sdp
            )
            for candidate in local_candidates:
                self.provider.arlo.NotifyPushToTalkCandidate(
                    self.arlo_basestation, self.arlo_device,
                    session_id, candidate
                )

        self.create_task(async_setup())

    async def stopIntercom(self):
        self.logger.info("Stopping intercom")
        if self.pc:
            await self.pc.close()
        self.pc = None
        self.sdp_answered = False

    def _update_device_details(self, arlo_device):
        """For updating device details from the Arlo dictionary retrieved from Arlo's REST API.
        """
        self.batteryLevel = arlo_device["properties"].get("batteryLevel")