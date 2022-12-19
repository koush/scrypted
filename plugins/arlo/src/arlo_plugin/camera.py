from aioice import Candidate
from aiortc import RTCPeerConnection, RTCSessionDescription, RTCIceGatherer, RTCIceServer
from aiortc.contrib.media import MediaPlayer
from aiortc.rtcicetransport import candidate_to_aioice, candidate_from_aioice 
import asyncio
import json

import scrypted_sdk
from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import Camera, VideoCamera, Intercom, MotionSensor, Battery, ScryptedMimeTypes

from .logging import ScryptedDeviceLoggerMixin

class ArloCamera(ScryptedDeviceBase, Camera, VideoCamera, Intercom, MotionSensor, Battery, ScryptedDeviceLoggerMixin):
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

        self.stop_intercom = True
        self.pc = None

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

        real_device = await scrypted_sdk.systemManager.api.getDeviceById(self.deviceState._id)
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

        self.stop_intercom = False

        ffmpeg_params = json.loads(await scrypted_sdk.mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput.value))
        self.logger.debug(f"Received ffmpeg params: {ffmpeg_params}")

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

        self.logger.info(f"Local candidates: {local_candidates}")

        # MediaPlayer/PyAV will block until the intercom stream starts, and it seems that scrypted waits
        # for startIntercom to exit before sending data. So, let's do the remaining setup in a coroutine
        # so this function can return early.
        async def async_setup(self):
            try:
                media_player = MediaPlayer(ffmpeg_params["url"], format="rtsp")

                pc = self.pc = RTCPeerConnection()
                pc.addTrack(media_player.audio)
                offer = await pc.createOffer()
                await pc.setLocalDescription(offer)

                # this class is here so that we can modify an outer scope's
                # variable from within the callbacks
                class has_received_sdp:
                    received = False

                def on_remote_sdp(sdp):
                    if not has_received_sdp.received:
                        if "a=mid:" not in sdp:
                            # arlo appears to not return a mux id in the response, which
                            # doesn't play nicely with aiortc. let's add it
                            sdp += "a=mid:0\r\n"

                        sdp = RTCSessionDescription(sdp=sdp, type="answer")
                        has_received_sdp.received = True

                        asyncio.get_event_loop().create_task(pc.setRemoteDescription(sdp))
                    return self.stop_intercom 

                def on_remote_candidate(candidate):
                    prefix = "a=candidate:"
                    if candidate.startswith(prefix):
                        candidate = candidate[len(prefix):]

                    candidate = candidate_from_aioice(Candidate.from_sdp(candidate))
                    if candidate.sdpMid is None:
                        # arlo appears to not return a mux id in the response, which
                        # doesn't play nicely with aiortc. let's add it
                        candidate.sdpMid = 0

                    asyncio.get_event_loop().create_task(pc.addIceCandidate(candidate))
                    return self.stop_intercom

                self.provider.arlo.DoPushToTalkNegotiation(
                    self.arlo_basestation, self.arlo_device,
                    session_id, offer.sdp, local_candidates,
                    on_remote_sdp, on_remote_candidate
                )
            except Exception as e:
                self.logger.error(e, exc_info=True)

        asyncio.get_event_loop().create_task(async_setup(self))

    async def stopIntercom(self):
        try:
            self.logger.info("Stopping intercom")
            self.stop_intercom = True
            if self.pc is not None:
                asyncio.get_event_loop().create_task(self.pc.close())
            self.pc = None
        except Exception as e:
            self.logger.info(e)

    def _update_device_details(self, arlo_device):
        """For updating device details from the Arlo dictionary retrieved from Arlo's REST API.
        """
        self.batteryLevel = arlo_device["properties"].get("batteryLevel")