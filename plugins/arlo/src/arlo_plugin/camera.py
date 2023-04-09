from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
import json
import threading
import time
from typing import List, TYPE_CHECKING

import scrypted_arlo_go

import scrypted_sdk
from scrypted_sdk.types import Setting, Settings, Device, Camera, VideoCamera, VideoClips, VideoClip, VideoClipOptions, MotionSensor, AudioSensor, Battery, DeviceProvider, MediaObject, ResponsePictureOptions, ResponseMediaStreamOptions, ScryptedMimeTypes, ScryptedInterface, ScryptedDeviceType

from .base import ArloDeviceBase
from .spotlight import ArloSpotlight, ArloFloodlight
from .vss import ArloSirenVirtualSecuritySystem
from .child_process import HeartbeatChildProcess
from .util import BackgroundTaskMixin, async_print_exception_guard

if TYPE_CHECKING:
    # https://adamj.eu/tech/2021/05/13/python-type-hints-how-to-fix-circular-imports/
    from .provider import ArloProvider


class ArloCamera(ArloDeviceBase, Settings, Camera, VideoCamera, DeviceProvider, VideoClips, MotionSensor, AudioSensor, Battery):
    MODELS_WITH_SPOTLIGHTS = [
        "vmc4040p",
        "vmc2030",
        "vmc2032",
        "vmc4041p",
        "vmc4050p",
        "vmc5040",
        "vml2030",
        "vml4030",
    ]

    MODELS_WITH_FLOODLIGHTS = ["fb1001"]

    MODELS_WITH_SIRENS = [
        "vmc4040p",
        "fb1001",
        "vmc2030",
        "vmc2020",
        "vmc2032",
        "vmc4041p",
        "vmc4050p",
        "vmc5040",
        "vml2030",
        "vmc4030",
        "vml4030",
        "vmc4030p",
    ]

    MODELS_WITH_AUDIO_SENSORS = [
        "vmc4040p",
        "fb1001",
        "vmc4041p",
        "vmc4050p",
        "vmc5040",
        "vmc3040",
        "vmc3040s",
        "vmc4030",
        "vml4030",
        "vmc4030p",
    ]

    MODELS_WITHOUT_BATTERY = [
        "avd1001",
        "vmc3040",
        "vmc3040s",
    ]

    timeout: int = 30
    intercom_session = None
    light: ArloSpotlight = None
    vss: ArloSirenVirtualSecuritySystem = None

    def __init__(self, nativeId: str, arlo_device: dict, arlo_basestation: dict, provider: ArloProvider) -> None:
        super().__init__(nativeId=nativeId, arlo_device=arlo_device, arlo_basestation=arlo_basestation, provider=provider)
        self.start_motion_subscription()
        self.start_audio_subscription()
        self.start_battery_subscription()

    def start_motion_subscription(self) -> None:
        def callback(motionDetected):
            self.motionDetected = motionDetected
            return self.stop_subscriptions

        self.register_task(
            self.provider.arlo.SubscribeToMotionEvents(self.arlo_basestation, self.arlo_device, callback)
        )

    def start_audio_subscription(self) -> None:
        if not self.has_audio_sensor:
            return

        def callback(audioDetected):
            self.audioDetected = audioDetected
            return self.stop_subscriptions

        self.register_task(
            self.provider.arlo.SubscribeToAudioEvents(self.arlo_basestation, self.arlo_device, callback)
        )

    def start_battery_subscription(self) -> None:
        if self.wired_to_power:
            return

        def callback(batteryLevel):
            self.batteryLevel = batteryLevel
            return self.stop_subscriptions

        self.register_task(
            self.provider.arlo.SubscribeToBatteryEvents(self.arlo_basestation, self.arlo_device, callback)
        )

    def get_applicable_interfaces(self) -> List[str]:
        results = set([
            ScryptedInterface.VideoCamera.value,
            ScryptedInterface.Camera.value,
            ScryptedInterface.MotionSensor.value,
            ScryptedInterface.Settings.value,
        ])

        if self.two_way_audio:
            results.discard(ScryptedInterface.RTCSignalingChannel.value)
            results.add(ScryptedInterface.Intercom.value)

        if self.webrtc_emulation:
            results.add(ScryptedInterface.RTCSignalingChannel.value)
            results.discard(ScryptedInterface.Intercom.value)

        if self.has_battery:
            results.add(ScryptedInterface.Battery.value)

        if self.wired_to_power:
            results.discard(ScryptedInterface.Battery.value)

        if self.has_siren or self.has_spotlight or self.has_floodlight:
            results.add(ScryptedInterface.DeviceProvider.value)

        if self.has_audio_sensor:
            results.add(ScryptedInterface.AudioSensor.value)

        if self.has_cloud_recording:
            results.add(ScryptedInterface.VideoClips.value)

        if not self._can_push_to_talk():
            results.discard(ScryptedInterface.RTCSignalingChannel.value)
            results.discard(ScryptedInterface.Intercom.value)

        return list(results)

    def get_device_type(self) -> str:
        return ScryptedDeviceType.Camera.value

    def get_builtin_child_device_manifests(self) -> List[Device]:
        results = []
        if self.has_spotlight or self.has_floodlight:
            light = self.get_or_create_spotlight_or_floodlight()
            results.append({
                "info": {
                    "model": f"{self.arlo_device['modelId']} {self.arlo_device['properties'].get('hwVersion', '')}".strip(),
                    "manufacturer": "Arlo",
                    "firmware": self.arlo_device.get("firmwareVersion"),
                    "serialNumber": self.arlo_device["deviceId"],
                },
                "nativeId": light.nativeId,
                "name": f'{self.arlo_device["deviceName"]} {"Spotlight" if self.has_spotlight else "Floodlight"}',
                "interfaces": light.get_applicable_interfaces(),
                "type": light.get_device_type(),
                "providerNativeId": self.nativeId,
            })
        if self.has_siren:
            vss = self.get_or_create_vss()
            results.extend([
                {
                    "info": {
                        "model": f"{self.arlo_device['modelId']} {self.arlo_device['properties'].get('hwVersion', '')}".strip(),
                        "manufacturer": "Arlo",
                        "firmware": self.arlo_device.get("firmwareVersion"),
                        "serialNumber": self.arlo_device["deviceId"],
                    },
                    "nativeId": vss.nativeId,
                    "name": f'{self.arlo_device["deviceName"]} Siren Virtual Security System',
                    "interfaces": vss.get_applicable_interfaces(),
                    "type": vss.get_device_type(),
                    "providerNativeId": self.nativeId,
                },
            ] + vss.get_builtin_child_device_manifests())
        return results

    @property
    def webrtc_emulation(self) -> bool:
        if self.storage:
            return True if self.storage.getItem("webrtc_emulation") else False
        else:
            return False

    @property
    def two_way_audio(self) -> bool:
        if self.storage:
            val = self.storage.getItem("two_way_audio")
            if val is None:
                val = True
            return val
        else:
            return True

    @property
    def wired_to_power(self) -> bool:
        if self.storage:
            return True if self.storage.getItem("wired_to_power") else False
        else:
            return False

    @property
    def has_cloud_recording(self) -> bool:
        return self.provider.arlo.GetSmartFeatures(self.arlo_device).get("planFeatures", {}).get("eventRecording", False)

    @property
    def has_spotlight(self) -> bool:
        return any([self.arlo_device["modelId"].lower().startswith(model) for model in ArloCamera.MODELS_WITH_SPOTLIGHTS])

    @property
    def has_floodlight(self) -> bool:
        return any([self.arlo_device["modelId"].lower().startswith(model) for model in ArloCamera.MODELS_WITH_FLOODLIGHTS])

    @property
    def has_siren(self) -> bool:
        return any([self.arlo_device["modelId"].lower().startswith(model) for model in ArloCamera.MODELS_WITH_SIRENS])

    @property
    def has_audio_sensor(self) -> bool:
        return any([self.arlo_device["modelId"].lower().startswith(model) for model in ArloCamera.MODELS_WITH_AUDIO_SENSORS])

    @property
    def has_battery(self) -> bool:
        return not any([self.arlo_device["modelId"].lower().startswith(model) for model in ArloCamera.MODELS_WITHOUT_BATTERY])

    async def getSettings(self) -> List[Setting]:
        result = []
        if self.has_battery:
            result.append(
                {
                    "key": "wired_to_power",
                    "title": "Plugged In to External Power",
                    "value": self.wired_to_power,
                    "description": "Informs Scrypted that this device is plugged in to an external power source. " + \
                                   "Will allow features like persistent prebuffer to work, however will no longer report this device's battery percentage. " + \
                                   "Note that a persistent prebuffer may cause excess battery drain if the external power is not able to charge faster than the battery consumption rate.",
                    "type": "boolean",
                },
            )
        if self._can_push_to_talk():
            result.extend([
                {
                    "key": "two_way_audio",
                    "title": "(Experimental) Enable native two-way audio",
                    "value": self.two_way_audio,
                    "description": "Enables two-way audio for this device. Not yet completely functional on all audio senders.",
                    "type": "boolean",
                },
                {
                    "key": "webrtc_emulation",
                    "title": "(Highly Experimental) Emulate WebRTC Camera",
                    "value": self.webrtc_emulation,
                    "description": "Configures the plugin to offer this device as a WebRTC camera, merging video/audio stream with two-way audio. "
                                   "If enabled, takes precedence over native two-way audio. May use increased system resources.",
                    "type": "boolean",
                },
            ])
        return result

    @async_print_exception_guard
    async def putSetting(self, key, value) -> None:
        if key in ["webrtc_emulation", "two_way_audio", "wired_to_power"]:
            self.storage.setItem(key, value == "true" or value == True)
            await self.provider.discover_devices()

    async def getPictureOptions(self) -> List[ResponsePictureOptions]:
        return []

    @async_print_exception_guard
    async def takePicture(self, options: dict = None) -> MediaObject:
        self.logger.info("Taking picture")

        real_device = await scrypted_sdk.systemManager.api.getDeviceById(self.getScryptedProperty("id"))
        msos = await real_device.getVideoStreamOptions()
        if any(["prebuffer" in m for m in msos]):
            self.logger.info("Getting snapshot from prebuffer")
            try:
                return await real_device.getVideoStream({"refresh": False})
            except Exception as e:
                self.logger.warning(f"Could not fetch from prebuffer due to: {e}")
                self.logger.warning("Will try to fetch snapshot from Arlo cloud")

        pic_url = await asyncio.wait_for(self.provider.arlo.TriggerFullFrameSnapshot(self.arlo_basestation, self.arlo_device), timeout=self.timeout)
        self.logger.debug(f"Got snapshot URL for at {pic_url}")

        if pic_url is None:
            raise Exception("Error taking snapshot")

        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(pic_url), ScryptedMimeTypes.Url.value)

    async def getVideoStreamOptions(self) -> List[ResponseMediaStreamOptions]:
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

    async def _getVideoStreamURL(self) -> str:
        self.logger.info("Requesting stream")
        rtsp_url = await asyncio.wait_for(self.provider.arlo.StartStream(self.arlo_basestation, self.arlo_device), timeout=self.timeout)
        self.logger.debug(f"Got stream URL at {rtsp_url}")
        return rtsp_url

    async def getVideoStream(self, options: dict = None) -> MediaObject:
        self.logger.debug("Entered getVideoStream")
        rtsp_url = await self._getVideoStreamURL()

        mso = (await self.getVideoStreamOptions())[0]
        mso['refreshAt'] = round(time.time() * 1000) + 30 * 60 * 1000

        ffmpeg_input = {
            'url': rtsp_url,
            'container': 'rtsp',
            'mediaStreamOptions': mso,
            'inputArguments': [
                '-f', 'rtsp',
                '-i', rtsp_url,
            ]
        }
        return await scrypted_sdk.mediaManager.createFFmpegMediaObject(ffmpeg_input)

    @async_print_exception_guard
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

    async def startIntercom(self, media) -> None:
        self.logger.info("Starting intercom")
        self.intercom_session = ArloCameraRTCSignalingSession(self)
        await self.intercom_session.initialize_push_to_talk(media)

    async def stopIntercom(self) -> None:
        self.logger.info("Stopping intercom")
        if self.intercom_session is not None:
            await self.intercom_session.shutdown()
            self.intercom_session = None

    def _can_push_to_talk(self) -> bool:
        # Right now, only implement push to talk for basestation cameras
        return self.arlo_device["deviceId"] != self.arlo_device["parentId"]

    async def getVideoClip(self, videoId: str) -> MediaObject:
        self.logger.info(f"Getting video clip {videoId}")

        id_as_time = int(videoId) / 1000.0
        start = datetime.fromtimestamp(id_as_time) - timedelta(seconds=10)
        end = datetime.fromtimestamp(id_as_time) + timedelta(seconds=10)

        library = self.provider.arlo.GetLibrary(self.arlo_device, start, end)
        for recording in library:
            if videoId == recording["name"]:
                return await scrypted_sdk.mediaManager.createMediaObjectFromUrl(recording["presignedContentUrl"])
        self.logger.warn(f"Clip {videoId} not found")
        return None

    async def getVideoClipThumbnail(self, thumbnailId: str) -> MediaObject:
        self.logger.info(f"Getting video clip thumbnail {thumbnailId}")

        id_as_time = int(thumbnailId) / 1000.0
        start = datetime.fromtimestamp(id_as_time) - timedelta(seconds=10)
        end = datetime.fromtimestamp(id_as_time) + timedelta(seconds=10)

        library = self.provider.arlo.GetLibrary(self.arlo_device, start, end)
        for recording in library:
            if thumbnailId == recording["name"]:
                return await scrypted_sdk.mediaManager.createMediaObjectFromUrl(recording["presignedThumbnailUrl"])
        self.logger.warn(f"Clip thumbnail {thumbnailId} not found")
        return None

    async def getVideoClips(self, options: VideoClipOptions = None) -> List[VideoClip]:
        self.logger.info(f"Fetching remote video clips {options}")

        start = datetime.fromtimestamp(options["startTime"] / 1000.0)
        end = datetime.fromtimestamp(options["endTime"] / 1000.0)

        library = self.provider.arlo.GetLibrary(self.arlo_device, start, end)
        clips = []
        for recording in library:
            clip = {
                "duration": recording["mediaDurationSecond"] * 1000.0,
                "id": recording["name"],
                "thumbnailId": recording["name"],
                "videoId": recording["name"],
                "startTime": recording["utcCreatedDate"],
                "description": recording["reason"],
                "resources": {
                    "thumbnail": {
                        "href": recording["presignedThumbnailUrl"],
                    },
                    "video": {
                        "href": recording["presignedContentUrl"],
                    },
                },
            }
            clips.append(clip)

        if options.get("reverseOrder"):
            clips.reverse()
        return clips

    @async_print_exception_guard
    async def removeVideoClips(self, videoClipIds: List[str]) -> None:
        # Arlo does support deleting, but let's be safe and disable that
        raise Exception("deleting Arlo video clips is not implemented by this plugin")

    async def getDevice(self, nativeId: str) -> ArloDeviceBase:
        if (nativeId.endswith("spotlight") and self.has_spotlight) or (nativeId.endswith("floodlight") and self.has_floodlight):
            return self.get_or_create_spotlight_or_floodlight()
        if nativeId.endswith("vss") and self.has_siren:
            return self.get_or_create_vss()
        return None

    def get_or_create_spotlight_or_floodlight(self) -> ArloSpotlight:
        if self.has_spotlight:
            light_id = f'{self.arlo_device["deviceId"]}.spotlight'
            if not self.light:
                self.light = ArloSpotlight(light_id, self.arlo_device, self.arlo_basestation, self.provider, self)
        elif self.has_floodlight:
            light_id = f'{self.arlo_device["deviceId"]}.floodlight'
            if not self.light:
                self.light = ArloFloodlight(light_id, self.arlo_device, self.arlo_basestation, self.provider, self)
        return self.light

    def get_or_create_vss(self) -> ArloSirenVirtualSecuritySystem:
        if self.has_siren:
            vss_id = f'{self.arlo_device["deviceId"]}.vss'
            if not self.vss:
                self.vss = ArloSirenVirtualSecuritySystem(vss_id, self.arlo_device, self.arlo_basestation, self.provider, self)
        return self.vss


class ArloCameraRTCSignalingSession(BackgroundTaskMixin):
    def __init__(self, camera):
        super().__init__()
        self.camera = camera
        self.logger = camera.logger
        self.provider = camera.provider
        self.arlo_device = camera.arlo_device
        self.arlo_basestation = camera.arlo_basestation

        self.ffmpeg_subprocess = None
        self.intercom_ffmpeg_subprocess = None

        self.scrypted_pc = None
        self.arlo_pc = None
        self.arlo_sdp_answered = False

        self.stop_subscriptions = False
        self.start_sdp_answer_subscription()
        self.start_candidate_answer_subscription()

    def __del__(self):
        self.stop_subscriptions = True
        self.cancel_pending_tasks()

    def start_sdp_answer_subscription(self):
        def callback(sdp):
            if self.arlo_pc and not self.arlo_sdp_answered:
                if "a=mid:" not in sdp:
                    # arlo appears to not return a mux id in the response, which
                    # doesn't play nicely with our webrtc peers. let's add it
                    sdp += "a=mid:0\r\n"
                self.logger.info(f"Arlo response sdp:\n{sdp}")

                sdp = scrypted_arlo_go.WebRTCSessionDescription(scrypted_arlo_go.NewWebRTCSDPType("answer"), sdp)
                self.arlo_pc.SetRemoteDescription(sdp)
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

                candidate = scrypted_arlo_go.WebRTCICECandidateInit(candidate, "0", 0)
                self.arlo_pc.AddICECandidate(candidate)
            return self.stop_subscriptions

        self.register_task(
            self.provider.arlo.SubscribeToCandidateAnswers(self.arlo_basestation, self.arlo_device, callback)
        )

    async def initialize(self):
        self.logger.info("Initializing video stream for RTC")
        rtsp_url = await self.camera._getVideoStreamURL()

        cfg = scrypted_arlo_go.WebRTCConfiguration(
            ICEServers=scrypted_arlo_go.Slice_webrtc_ICEServer([
                scrypted_arlo_go.NewWebRTCICEServer(
                    scrypted_arlo_go.go.Slice_string(["turn:turn0.clockworkmod.com", "turn:n0.clockworkmod.com", "turn:n1.clockworkmod.com"]),
                    "foo",
                    "bar"
                )
            ])
        )
        cfg = scrypted_arlo_go.WebRTCConfiguration()
        self.scrypted_pc = scrypted_arlo_go.NewWebRTCManager("Arlo "+self.camera.logger_name, cfg)

        audio_port = self.scrypted_pc.InitializeAudioRTPListener(scrypted_arlo_go.WebRTCMimeTypeOpus)
        video_port = self.scrypted_pc.InitializeVideoRTPListener(scrypted_arlo_go.WebRTCMimeTypeH264)

        ffmpeg_path = await scrypted_sdk.mediaManager.getFFmpegPath()
        ffmpeg_args = [
            "-y",
            "-hide_banner",
            "-loglevel", "error",
            "-analyzeduration", "0",
            "-fflags", "-nobuffer",
            "-max_probe_packets", "2",
            "-vcodec", "h264",
            "-acodec", "aac",
            "-i", rtsp_url,
            "-an",
            "-vcodec", "copy",
            "-f", "rtp",
            "-flush_packets", "1",
            f"rtp://localhost:{video_port}",
            "-vn",
            "-acodec", "libopus",
            "-f", "rtp",
            "-flush_packets", "1",
            f"rtp://localhost:{audio_port}?pkt_size={scrypted_arlo_go.UDP_PACKET_SIZE()}",
        ]
        self.logger.debug(f"Starting ffmpeg at {ffmpeg_path} with {ffmpeg_args}")

        self.ffmpeg_subprocess = HeartbeatChildProcess("Arlo "+self.camera.logger_name, ffmpeg_path, *ffmpeg_args)
        self.ffmpeg_subprocess.start()

        if self.camera._can_push_to_talk():
            self.create_task(self.initialize_push_to_talk())

    async def initialize_push_to_talk(self, media=None):
        try:
            self.logger.info("Initializing push to talk")

            session_id, ice_servers = self.provider.arlo.StartPushToTalk(self.arlo_basestation, self.arlo_device)
            self.logger.debug(f"Received ice servers: {[ice['url'] for ice in ice_servers]}")

            cfg = scrypted_arlo_go.WebRTCConfiguration(
                ICEServers=scrypted_arlo_go.Slice_webrtc_ICEServer([
                    scrypted_arlo_go.NewWebRTCICEServer(
                        scrypted_arlo_go.go.Slice_string([ice['url']]),
                        ice.get('username', ''),
                        ice.get('credential', '')
                    )
                    for ice in ice_servers
                ])
            )
            self.arlo_pc = scrypted_arlo_go.NewWebRTCManager("Arlo "+self.camera.logger_name, cfg)

            if media is not None:
                ffmpeg_params = json.loads(await scrypted_sdk.mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput.value))
                self.logger.debug(f"Received ffmpeg params: {ffmpeg_params}")
                audio_port = self.arlo_pc.InitializeAudioRTPListener(scrypted_arlo_go.WebRTCMimeTypeOpus)

                ffmpeg_path = await scrypted_sdk.mediaManager.getFFmpegPath()
                ffmpeg_args = [
                    "-y",
                    "-hide_banner",
                    "-loglevel", "error",
                    "-analyzeduration", "0",
                    "-fflags", "-nobuffer",
                    "-probesize", "500000",
                    *ffmpeg_params["inputArguments"],
                    "-vn",
                    "-acodec", "libopus",
                    "-f", "rtp",
                    "-flush_packets", "1",
                    f"rtp://localhost:{audio_port}?pkt_size={scrypted_arlo_go.UDP_PACKET_SIZE()}",
                ]
                self.logger.debug(f"Starting ffmpeg at {ffmpeg_path} with {ffmpeg_args}")

                self.intercom_ffmpeg_subprocess = HeartbeatChildProcess("Arlo "+self.camera.logger_name, ffmpeg_path, *ffmpeg_args)
                self.intercom_ffmpeg_subprocess.start()
            else:
                self.logger.debug("Starting audio track forwarder")
                self.scrypted_pc.ForwardAudioTo(self.arlo_pc)
                self.logger.debug("Started audio track forwarder")

            self.sdp_answered = False

            offer = self.arlo_pc.CreateOffer()
            offer_sdp = scrypted_arlo_go.WebRTCSessionDescriptionSDP(offer)
            self.logger.info(f"Arlo offer sdp:\n{offer_sdp}")

            self.arlo_pc.SetLocalDescription(offer)

            self.provider.arlo.NotifyPushToTalkSDP(
                self.arlo_basestation, self.arlo_device,
                session_id, offer_sdp
            )

            def forward_candidates():
                try:
                    candidates = self.arlo_pc.WaitAndGetICECandidates()
                    self.logger.debug(f"Gathered {len(candidates)} candidates")
                    for candidate in candidates:
                        candidate = scrypted_arlo_go.WebRTCICECandidateInit(
                            scrypted_arlo_go.WebRTCICECandidate(handle=candidate).ToJSON()
                        ).Candidate
                        self.logger.debug(f"Sending candidate to Arlo: {candidate}")
                        self.provider.arlo.NotifyPushToTalkCandidate(
                            self.arlo_basestation, self.arlo_device,
                            session_id, candidate,
                        )
                except Exception as e:
                    self.logger.error(e)
            t = threading.Thread(target=forward_candidates)
            t.start()
        except Exception as e:
            self.logger.error(e)

    async def createLocalDescription(self, type, setup, sendIceCandidate=None):
        if type == "offer":
            raise Exception("can only create answers in ArloCameraRTCSignalingSession.createLocalDescription")

        answer = self.scrypted_pc.CreateAnswer()
        answer_sdp = scrypted_arlo_go.WebRTCSessionDescriptionSDP(answer)

        self.scrypted_pc.SetLocalDescription(answer)

        if sendIceCandidate is not None:
            loop = asyncio.get_event_loop()
            def forward_candidates():
                try:
                    candidates = self.scrypted_pc.WaitAndGetICECandidates()
                    self.logger.debug(f"Gathered {len(candidates)} candidates")
                    for candidate in candidates:
                        candidate = scrypted_arlo_go.WebRTCICECandidateInit(
                            scrypted_arlo_go.WebRTCICECandidate(handle=candidate).ToJSON()
                        ).Candidate
                        self.logger.debug(f"Sending candidate to scrypted: {candidate}")
                        loop.call_soon_threadsafe(
                            self.create_task,
                            sendIceCandidate({
                                "candidate": candidate,
                                "sdpMid": "0",
                                "sdpMLineIndex": 0,
                            })
                        )
                except Exception as e:
                    self.logger.error(e)
            t = threading.Thread(target=forward_candidates)
            t.start()

        return {
            "sdp": answer_sdp,
            "type": "answer"
        }

    async def setRemoteDescription(self, description, setup):
        if description["type"] != "offer":
            raise Exception("can only accept offers in ArloCameraRTCSignalingSession.createLocalDescription")

        sdp = scrypted_arlo_go.WebRTCSessionDescription(scrypted_arlo_go.NewWebRTCSDPType("offer"), description["sdp"])
        self.scrypted_pc.SetRemoteDescription(sdp)

    async def addIceCandidate(self, candidate):
        candidate = scrypted_arlo_go.WebRTCICECandidateInit(candidate["candidate"], "0", 0)
        self.scrypted_pc.AddICECandidate(candidate)

    async def getOptions(self):
        pass

    async def unmute_relay(self):
        return
        await self.arlo_pc.unmute_relay(self.arlo_relay_track)

    async def mute_relay(self):
        return
        await self.arlo_pc.mute_relay(self.arlo_relay_track)

    async def shutdown(self):
        if self.ffmpeg_subprocess is not None:
            self.ffmpeg_subprocess.stop()
            self.ffmpeg_subprocess = None
        if self.intercom_ffmpeg_subprocess is not None:
            self.intercom_ffmpeg_subprocess.stop()
            self.intercom_ffmpeg_subprocess = None
        if self.scrypted_pc is not None:
            self.scrypted_pc.Close()
            self.scrypted_pc = None
        if self.arlo_pc is not None:
            self.arlo_pc.Close()
            self.arlo_pc = None


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
        self.logger.info("Ending RTC session")
        await self.arlo_session.shutdown()