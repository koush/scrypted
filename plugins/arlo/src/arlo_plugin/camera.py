from aioice import Candidate
from aiortc import RTCSessionDescription, RTCIceGatherer, RTCIceServer
from aiortc.rtcicetransport import candidate_to_aioice, candidate_from_aioice 
import asyncio
import socket

import scrypted_sdk
from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import Camera, VideoCamera, MotionSensor, Battery, ScryptedMimeTypes

from .child_process import ChildProcess
from .logging import ScryptedDeviceLoggerMixin
from .util import BackgroundTaskMixin
from .rtcpeerconnection import BackgroundRTCPeerConnection


class ArloCamera(ScryptedDeviceBase, Camera, VideoCamera, MotionSensor, Battery, ScryptedDeviceLoggerMixin, BackgroundTaskMixin):
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

    async def _getVideoStreamURL(self):
        self.logger.info("Requesting stream")
        rtsp_url = await asyncio.wait_for(self.provider.arlo.StartStream(self.arlo_basestation, self.arlo_device), timeout=self.timeout)
        self.logger.debug(f"Got stream URL at {rtsp_url}")
        return rtsp_url

    async def getVideoStream(self, options=None):
        self.logger.debug("Entered getVideoStream")
        rtsp_url = await self._getVideoStreamURL()
        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(rtsp_url), ScryptedMimeTypes.Url.value)

    async def startRTCSignalingSession(self, scrypted_session):
        plugin_session = ArloCameraRTCSignalingSession(self)
        await plugin_session.initialize()

        scrypted_setup = {
            "type": "offer",
            "audio": {
                "direction": "sendrecv" if self._can_push_to_talk() else "recvonly",
            },
            "video": {
                "direction": "recvonly",
            }
        }
        plugin_setup = {}

        scrypted_offer = await scrypted_session.createLocalDescription("offer", scrypted_setup, sendIceCandidate=plugin_session.addIceCandidate)
        self.logger.info(f"Scrypted offer sdp:\n{scrypted_offer['sdp']}")
        await plugin_session.setRemoteDescription(scrypted_offer, plugin_setup)
        plugin_answer = await plugin_session.createLocalDescription("answer", plugin_setup, scrypted_session.sendIceCandidate)
        self.logger.info(f"Scrypted answer sdp:\n{plugin_answer['sdp']}")
        await scrypted_session.setRemoteDescription(plugin_answer, scrypted_setup)

        return ArloCameraRTCSessionControl(plugin_session)

    def _update_device_details(self, arlo_device):
        """For updating device details from the Arlo dictionary retrieved from Arlo's REST API.
        """
        self.batteryLevel = arlo_device["properties"].get("batteryLevel")

    def _can_push_to_talk(self):
        # Right now, only implement push to talk for basestation cameras
        return self.arlo_device["deviceId"] != self.arlo_device["parentId"]


class ArloCameraRTCSignalingSession(BackgroundTaskMixin):
    def __init__(self, camera):
        super().__init__()
        self.camera = camera
        self.logger = camera.logger
        self.provider = camera.provider
        self.arlo_device = camera.arlo_device
        self.arlo_basestation = camera.arlo_basestation

        self.ffmpeg_subprocess = None

        self.pc = None
        self.local_candidates = None
        self.arlo_pc = None
        self.arlo_sdp_answered = False
        self.arlo_relay_track = None

        self.stop_subscriptions = False
        self.start_sdp_answer_subscription()
        self.start_candidate_answer_subscription()

    def __del__(self):
        self.stop_subscriptions = True

    def start_sdp_answer_subscription(self):
        def callback(sdp):
            if self.arlo_pc and not self.arlo_sdp_answered:
                if "a=mid:" not in sdp:
                    # arlo appears to not return a mux id in the response, which
                    # doesn't play nicely with our webrtc peers. let's add it
                    sdp += "a=mid:0\r\n"
                self.logger.info(f"Arlo response sdp:\n{sdp}")

                sdp = RTCSessionDescription(sdp=sdp, type="answer")
                self.create_task(self.arlo_pc.setRemoteDescription(sdp))
                self.arlo_sdp_answered = True
            return self.stop_subscriptions

        self.register_task(
            self.provider.arlo.SubscribeToSDPAnswers(self.arlo_basestation, self.arlo_device, callback)
        )

    def start_candidate_answer_subscription(self):
        def callback(candidate):
            if self.arlo_pc:
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
                self.create_task(self.arlo_pc.addIceCandidate(candidate))
            return self.stop_subscriptions

        self.register_task(
            self.provider.arlo.SubscribeToCandidateAnswers(self.arlo_basestation, self.arlo_device, callback)
        )

    async def initialize(self):
        self.logger.info("Initializing video stream for RTC")
        rtsp_url = await self.camera._getVideoStreamURL()

        # Reserve a port for us to give to ffmpeg
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind(('localhost', 0))
        port = sock.getsockname()[1]
        sock.close()

        ffmpeg_path = await scrypted_sdk.mediaManager.getFFmpegPath()
        ffmpeg_args = [
            "-y",
            "-hide_banner",
            "-loglevel", "error",
            "-analyzeduration", "0",
            "-fflags", "-nobuffer",
            "-probesize", "32",
            "-vcodec", "h264",
            "-acodec", "aac",
            "-i", rtsp_url,
            "-vcodec", "copy",
            "-acodec", "aac",
            "-f", "mpegts",
            "-flush_packets", "1",
            f"udp://localhost:{port}"
        ]
        self.logger.debug(f"Starting ffmpeg at {ffmpeg_path} with {ffmpeg_args}")

        self.ffmpeg_subprocess = ChildProcess(ffmpeg_path, *ffmpeg_args)
        self.ffmpeg_subprocess.start()

        self.pc = BackgroundRTCPeerConnection(self.logger)
        await self.pc.add_media(
            f"udp://localhost:{port}",
            format="mpegts",
            options={
                "vcodec": "h264",
                "acodec": "aac",
                "analyzeduration": "0",
                "probesize": "32"
            }
        )

        ice_gatherer = RTCIceGatherer()
        await ice_gatherer.gather()
        self.local_candidates = ice_gatherer.getLocalCandidates()

        if self.camera._can_push_to_talk():
            await self.initialize_push_to_talk()

    async def initialize_push_to_talk(self):
        self.logger.info("Initializing push to talk for RTC")

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
        self.logger.debug(f"Local candidates:\n{log_candidates}")

        self.arlo_pc = BackgroundRTCPeerConnection(self.logger, background=self.pc.background)

        received_audio_track = asyncio.get_event_loop().create_future()
        async def on_track(track):
            self.logger.debug(f"Received track from scrypted: {track.kind}")
            if track.kind == "audio" and self.arlo_relay_track is None:
                self.arlo_relay_track = await self.arlo_pc.subscribe_track(track)
                received_audio_track.set_result(True)
        self.pc.on_track(on_track)

        # Perform the remaining setup asynchronously later, since we need to finish initializing
        # before RTC session exchange can happen.
        async def async_setup():
            await received_audio_track
            self.sdp_answered = False

            offer = await self.arlo_pc.createOffer()
            self.logger.info(f"Arlo offer sdp:\n{offer.sdp}")

            await self.arlo_pc.setLocalDescription(offer)

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

    async def createLocalDescription(self, type, setup, sendIceCandidate=None):
        if type == "offer":
            raise Exception("can only create answers in ArloCameraRTCSignalingSession.createLocalDescription")

        if sendIceCandidate is not None:
            [
                await sendIceCandidate({
                    "candidate": Candidate.to_sdp(candidate_to_aioice(c)),
                    "sdpMid": c.sdpMid,
                    "sdpMLineIndex": c.sdpMLineIndex
                })
                for c in self.local_candidates
            ] 

        answer = await self.pc.createAnswer()
        await self.pc.setLocalDescription(answer)
        return {
            "sdp": answer.sdp,
            "type": "answer"
        }

    async def setRemoteDescription(self, description, setup):
        if description["type"] != "offer":
            raise Exception("can only accept offers in ArloCameraRTCSignalingSession.createLocalDescription")

        sdp = RTCSessionDescription(sdp=description["sdp"], type="offer")
        await self.pc.setRemoteDescription(sdp)

    async def addIceCandidate(self, candidate):
        candidate = candidate_from_aioice(Candidate.from_sdp(candidate["candidate"]))
        await self.pc.addIceCandidate(candidate)

    async def getOptions(self):
        pass

    async def unmute_relay(self):
        await self.arlo_pc.unmute_relay(self.arlo_relay_track)

    async def mute_relay(self):
        await self.arlo_pc.mute_relay(self.arlo_relay_track)

    async def shutdown(self):
        if self.ffmpeg_subprocess is not None:
            self.ffmpeg_subprocess.stop()
            self.ffmpeg_subprocess = None
        if self.pc is not None:
            await self.pc.close()
            self.pc = None
        if self.arlo_pc is not None:
            await self.arlo_pc.close()
            self.arlo_pc = None
            self.arlo_relay_track = None


class ArloCameraRTCSessionControl:
    def __init__(self, arlo_session):
        self.arlo_session = arlo_session
        self.logger = arlo_session.logger

    async def setPlayback(self, options):
        self.logger.debug(f"setPlayback options {options}")
        audio = options.get("audio")
        if audio is None:
            return
        if audio:
            await self.arlo_session.unmute_relay()
        else:
            await self.arlo_session.mute_relay()

    async def endSession(self):
        await self.arlo_session.shutdown()