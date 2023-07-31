from __future__ import annotations

import asyncio
import aiohttp
from async_timeout import timeout as async_timeout
from datetime import datetime, timedelta
import json
import socket
import time
import threading
from typing import List, TYPE_CHECKING

import scrypted_arlo_go

import scrypted_sdk
from scrypted_sdk.types import Setting, Settings, SettingValue, Device, Camera, VideoCamera, RequestMediaStreamOptions, VideoClips, VideoClip, VideoClipOptions, MotionSensor, AudioSensor, Battery, Charger, ChargeState, DeviceProvider, MediaObject, ResponsePictureOptions, ResponseMediaStreamOptions, ScryptedMimeTypes, ScryptedInterface, ScryptedDeviceType

from .arlo.arlo_async import USER_AGENTS
from .base import ArloDeviceBase
from .spotlight import ArloSpotlight, ArloFloodlight, ArloNightlight
from .vss import ArloSirenVirtualSecuritySystem
from .child_process import HeartbeatChildProcess
from .util import BackgroundTaskMixin, async_print_exception_guard

if TYPE_CHECKING:
    # https://adamj.eu/tech/2021/05/13/python-type-hints-how-to-fix-circular-imports/
    from .provider import ArloProvider


class ArloCameraIntercomSession(BackgroundTaskMixin):
    def __init__(self, camera: ArloCamera) -> None:
        super().__init__()
        self.camera = camera
        self.logger = camera.logger
        self.provider = camera.provider
        self.arlo_device = camera.arlo_device
        self.arlo_basestation = camera.arlo_basestation

    async def initialize_push_to_talk(self, media: MediaObject) -> None:
        raise NotImplementedError("not implemented")

    async def shutdown(self) -> None:
        raise NotImplementedError("not implemented")


class ArloCamera(ArloDeviceBase, Settings, Camera, VideoCamera, DeviceProvider, VideoClips, MotionSensor, AudioSensor, Battery, Charger):
    MODELS_WITH_SPOTLIGHTS = [
        "vmc2030",
        "vmc2032",
        "vmc4040p",
        "vmc4041p",
        "vmc4050p",
        "vmc4060p",
        "vmc5040",
        "vml2030",
        "vml4030",
    ]

    MODELS_WITH_FLOODLIGHTS = ["fb1001"]

    MODELS_WITH_NIGHTLIGHTS = [
        "abc1000",
        "abc1000a",
    ]

    MODELS_WITH_SIRENS = [
        "fb1001",
        "vmc2020",
        "vmc2030",
        "vmc2032",
        "vmc4030",
        "vmc4030p",
        "vmc4040p",
        "vmc4041p",
        "vmc4050p",
        "vmc4060p",
        "vmc5040",
        "vml2030",
        "vml4030",
    ]

    MODELS_WITH_AUDIO_SENSORS = [
        "abc1000",
        "abc1000a",
        "fb1001",
        "vmc3040",
        "vmc3040s",
        "vmc4030",
        "vmc4030p",
        "vmc4040p",
        "vmc4041p",
        "vmc4050p",
        "vmc5040",
        "vml4030",
    ]

    MODELS_WITHOUT_BATTERY = [
        "avd1001",
        "vmc2040",
        "vmc3040",
        "vmc3040s",
    ]

    timeout: int = 30
    intercom_session: ArloCameraIntercomSession = None
    light: ArloSpotlight = None
    vss: ArloSirenVirtualSecuritySystem = None

    # eco mode bookkeeping
    picture_lock: asyncio.Lock = None
    last_picture: bytes = None
    last_picture_time: datetime = datetime(1970, 1, 1)

    # socket logger
    logger_loop: asyncio.AbstractEventLoop = None
    logger_server: asyncio.AbstractServer = None
    logger_server_port: int = 0

    def __init__(self, nativeId: str, arlo_device: dict, arlo_basestation: dict, provider: ArloProvider) -> None:
        super().__init__(nativeId=nativeId, arlo_device=arlo_device, arlo_basestation=arlo_basestation, provider=provider)
        self.picture_lock = asyncio.Lock()

        self.start_error_subscription()
        self.start_motion_subscription()
        self.start_audio_subscription()
        self.start_battery_subscription()
        self.create_task(self.delayed_init())

    def __del__(self) -> None:
        super().__del__()
        def logger_exit_callback():
            self.logger_server.close()
            self.logger_loop.stop()
            self.logger_loop.close()
        self.logger_loop.call_soon_threadsafe(logger_exit_callback)

    async def delayed_init(self) -> None:
        await self.create_tcp_logger_server()

        if not self.has_battery:
            return

        iterations = 1
        while not self.stop_subscriptions:
            if iterations > 100:
                self.logger.error("Delayed init exceeded iteration limit, giving up")
                return

            try:
                self.chargeState = ChargeState.Charging.value if self.wired_to_power else ChargeState.NotCharging.value
                return
            except Exception as e:
                self.logger.debug(f"Delayed init failed, will try again: {e}")
                await asyncio.sleep(0.1)
            iterations += 1

    @async_print_exception_guard
    async def create_tcp_logger_server(self) -> None:
        self.logger_loop = asyncio.new_event_loop()

        def thread_main():
            asyncio.set_event_loop(self.logger_loop)
            self.logger_loop.run_forever()

        threading.Thread(target=thread_main).start()

        # this is a bit convoluted since we need the async functions to run in the
        # logger loop thread instead of in the current thread
        def setup_callback():
            async def callback(reader, writer):
                try:
                    while not reader.at_eof():
                        line = await reader.readline()
                        if not line:
                            break
                        line = str(line, 'utf-8')
                        line = line.rstrip()
                        self.logger.info(line)
                    writer.close()
                    await writer.wait_closed()
                except Exception:
                    self.logger.exception("Logger server callback raised an exception")

            async def setup():
                self.logger_server = await asyncio.start_server(callback, host='localhost', port=0, family=socket.AF_INET, flags=socket.SOCK_STREAM)
                self.logger_server_port = self.logger_server.sockets[0].getsockname()[1]
                self.logger.info(f"Started logging server at localhost:{self.logger_server_port}")

            self.logger_loop.create_task(setup())

        self.logger_loop.call_soon_threadsafe(setup_callback)


    def start_error_subscription(self) -> None:
        def callback(code, message):
            self.logger.error(f"Arlo returned error code {code} with message: {message}")
            return self.stop_subscriptions

        self.register_task(
            self.provider.arlo.SubscribeToErrorEvents(self.arlo_basestation, self.arlo_device, callback)
        )

    def start_motion_subscription(self) -> None:
        def callback(motionDetected):
            self.motionDetected = motionDetected
            return self.stop_subscriptions

        self.register_task(
            self.provider.arlo.SubscribeToMotionEvents(self.arlo_basestation, self.arlo_device, callback, self.logger)
        )

    def start_audio_subscription(self) -> None:
        if not self.has_audio_sensor:
            return

        def callback(audioDetected):
            self.audioDetected = audioDetected
            return self.stop_subscriptions

        self.register_task(
            self.provider.arlo.SubscribeToAudioEvents(self.arlo_basestation, self.arlo_device, callback, self.logger)
        )

    def start_battery_subscription(self) -> None:
        if not self.has_battery:
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

        if self.has_push_to_talk:
            results.add(ScryptedInterface.Intercom.value)

        if self.has_battery:
            results.add(ScryptedInterface.Battery.value)
            results.add(ScryptedInterface.Charger.value)

        if self.has_siren or self.has_spotlight or self.has_floodlight:
            results.add(ScryptedInterface.DeviceProvider.value)

        if self.has_audio_sensor:
            results.add(ScryptedInterface.AudioSensor.value)

        if self.has_cloud_recording:
            results.add(ScryptedInterface.VideoClips.value)

        return list(results)

    def get_device_type(self) -> str:
        return ScryptedDeviceType.Camera.value

    def get_builtin_child_device_manifests(self) -> List[Device]:
        results = []
        if self.has_spotlight or self.has_floodlight or self.has_nightlight:
            light = self.get_or_create_light()
            results.append({
                "info": {
                    "model": f"{self.arlo_device['modelId']} {self.arlo_device['properties'].get('hwVersion', '')}".strip(),
                    "manufacturer": "Arlo",
                    "firmware": self.arlo_device.get("firmwareVersion"),
                    "serialNumber": self.arlo_device["deviceId"],
                },
                "nativeId": light.nativeId,
                "name": f'{self.arlo_device["deviceName"]} {"Spotlight" if self.has_spotlight else "Floodlight" if self.has_floodlight else "Nightlight"}',
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
    def wired_to_power(self) -> bool:
        if self.storage:
            return True if self.storage.getItem("wired_to_power") else False
        else:
            return False

    @property
    def eco_mode(self) -> bool:
        if self.storage:
            return True if self.storage.getItem("eco_mode") else False
        else:
            return False

    @property
    def snapshot_throttle_interval(self) -> int:
        interval = self.storage.getItem("snapshot_throttle_interval")
        if interval is None:
            interval = 60
            self.storage.setItem("snapshot_throttle_interval", interval)
        return int(interval)

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
    def has_nightlight(self) -> bool:
        return any([self.arlo_device["modelId"].lower().startswith(model) for model in ArloCamera.MODELS_WITH_NIGHTLIGHTS])

    @property
    def has_siren(self) -> bool:
        return any([self.arlo_device["modelId"].lower().startswith(model) for model in ArloCamera.MODELS_WITH_SIRENS])

    @property
    def has_audio_sensor(self) -> bool:
        return any([self.arlo_device["modelId"].lower().startswith(model) for model in ArloCamera.MODELS_WITH_AUDIO_SENSORS])

    @property
    def has_battery(self) -> bool:
        return not any([self.arlo_device["modelId"].lower().startswith(model) for model in ArloCamera.MODELS_WITHOUT_BATTERY])

    @property
    def has_push_to_talk(self) -> bool:
        return bool(self.arlo_capabilities.get("Capabilities", {}).get("PushToTalk", {}).get("fullDuplex"))

    @property
    def uses_sip_push_to_talk(self) -> bool:
        return "sip" in self.arlo_capabilities.get("Capabilities", {}).get("PushToTalk", {}).get("signal", [])

    async def getSettings(self) -> List[Setting]:
        result = []
        if self.has_battery:
            result.append(
                {
                    "group": "General",
                    "key": "wired_to_power",
                    "title": "Plugged In to External Power",
                    "value": self.wired_to_power,
                    "description": "Informs Scrypted that this device is plugged in to an external power source. " + \
                                   "Will allow features like persistent prebuffer to work. " + \
                                   "Note that a persistent prebuffer may cause excess battery drain if the external power is not able to charge faster than the battery consumption rate.",
                    "type": "boolean",
                },
            )
        result.append(
            {
                "group": "General",
                "key": "eco_mode",
                "title": "Eco Mode",
                "value": self.eco_mode,
                "description": "Configures Scrypted to limit the number of requests made to this camera. " + \
                               "Additional eco mode settings will appear when this is turned on.",
                "type": "boolean",
            }
        )
        if self.eco_mode:
            result.append(
                {
                    "group": "Eco Mode",
                    "key": "snapshot_throttle_interval",
                    "title": "Snapshot Throttle Interval",
                    "value": self.snapshot_throttle_interval,
                    "description": "Time, in minutes, to throttle snapshot requests. " + \
                                   "When eco mode is on, snapshot requests to the camera will be throttled for the given duration. " + \
                                   "Cached snapshots may be returned if the time since the last snapshot has not exceeded the interval. " + \
                                   "A value of 0 will disable throttling even when eco mode is on.",
                    "type": "number",
                }
            )
        result.append(
            {
                "group": "General",
                "key": "print_debug",
                "title": "Debug Info",
                "description": "Prints information about this device to console.",
                "type": "button",
            }
        )
        return result

    @async_print_exception_guard
    async def putSetting(self, key: str, value: SettingValue) -> None:
        if not self.validate_setting(key, value):
            await self.onDeviceEvent(ScryptedInterface.Settings.value, None)
            return

        if key in ["wired_to_power"]:
            self.storage.setItem(key, value == "true" or value == True)
            await self.provider.discover_devices()
        elif key in ["eco_mode"]:
            self.storage.setItem(key, value == "true" or value == True)
        elif key == "print_debug":
            self.logger.info(f"Device Capabilities: {self.arlo_capabilities}")
        else:
            self.storage.setItem(key, value)
        await self.onDeviceEvent(ScryptedInterface.Settings.value, None)

    def validate_setting(self, key: str, val: SettingValue) -> bool:
        if key == "snapshot_throttle_interval":
            try:
                val = int(val)
            except ValueError:
                self.logger.error(f"Invalid snapshot throttle interval '{val}' - must be an integer")
                return False
        return True

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

        async with self.picture_lock:
            if self.eco_mode and self.snapshot_throttle_interval > 0:
                if datetime.now() - self.last_picture_time <= timedelta(minutes=self.snapshot_throttle_interval):
                    self.logger.info("Using cached image")
                    return await scrypted_sdk.mediaManager.createMediaObject(self.last_picture, "image/jpeg")

            pic_url = await asyncio.wait_for(self.provider.arlo.TriggerFullFrameSnapshot(self.arlo_basestation, self.arlo_device), timeout=self.timeout)
            self.logger.debug(f"Got snapshot URL for at {pic_url}")

            if pic_url is None:
                raise Exception("Error taking snapshot: no url returned")

            async with async_timeout(self.timeout):
                async with aiohttp.ClientSession() as session:
                    async with session.get(pic_url) as resp:
                        if resp.status != 200:
                            raise Exception(f"Unexpected status downloading snapshot image: {resp.status}")
                        self.last_picture = await resp.read()
                        self.last_picture_time = datetime.now()

            return await scrypted_sdk.mediaManager.createMediaObject(self.last_picture, "image/jpeg")

    async def getVideoStreamOptions(self, id: str = None) -> List[ResponseMediaStreamOptions]:
        options = [
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
            },
            {
                "id": 'dash',
                "name": 'Cloud DASH',
                "container": 'dash',
                "video": {
                    "codec": 'unknown',
                },
                "audio": None if self.arlo_device.get("modelId") == "VMC3030" else {
                    "codec": 'unknown',
                },
                "source": 'cloud',
                "tool": 'ffmpeg',
                "userConfigurable": False,
            }
        ]

        if id is None:
            return options

        return next(iter([o for o in options if o['id'] == id]))

    async def _getVideoStreamURL(self, container: str) -> str:
        self.logger.info(f"Requesting {container} stream")
        url = await asyncio.wait_for(self.provider.arlo.StartStream(self.arlo_basestation, self.arlo_device, mode=container), timeout=self.timeout)
        self.logger.debug(f"Got {container} stream URL at {url}")
        return url

    @async_print_exception_guard
    async def getVideoStream(self, options: RequestMediaStreamOptions = {}) -> MediaObject:
        self.logger.debug("Entered getVideoStream")

        mso = await self.getVideoStreamOptions(id=options.get("id", "default"))
        mso['refreshAt'] = round(time.time() * 1000) + 30 * 60 * 1000
        container = mso["container"]

        url = await self._getVideoStreamURL(container)
        additional_ffmpeg_args = []

        if container == "dash":
            headers = self.provider.arlo.GetMPDHeaders(url)
            ffmpeg_headers = '\r\n'.join([
                f'{k}: {v}'
                for k, v in headers.items()
            ])
            additional_ffmpeg_args = ['-headers', ffmpeg_headers+'\r\n']

        ffmpeg_input = {
            'url': url,
            'container': container,
            'mediaStreamOptions': mso,
            'inputArguments': [
                '-f', container,
                *additional_ffmpeg_args,
                '-i', url,
            ]
        }
        return await scrypted_sdk.mediaManager.createFFmpegMediaObject(ffmpeg_input)

    @async_print_exception_guard
    async def startIntercom(self, media: MediaObject) -> None:
        self.logger.info("Starting intercom")

        if self.uses_sip_push_to_talk:
            # signaling happens over sip
            self.intercom_session = ArloCameraSIPIntercomSession(self)
        else:
            # we need to do signaling through arlo cloud apis
            self.intercom_session = ArloCameraWebRTCIntercomSession(self)
        await self.intercom_session.initialize_push_to_talk(media)

        self.logger.info("Intercom initialized")

    @async_print_exception_guard
    async def stopIntercom(self) -> None:
        self.logger.info("Stopping intercom")
        if self.intercom_session is not None:
            await self.intercom_session.shutdown()
            self.intercom_session = None

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
        # Arlo Cloud does support deleting, but let's be safe and not expose that here
        raise Exception("deleting Arlo video clips is not implemented by this plugin - please delete clips through the Arlo app")

    async def getDevice(self, nativeId: str) -> ArloDeviceBase:
        if (nativeId.endswith("spotlight") and self.has_spotlight) or (nativeId.endswith("floodlight") and self.has_floodlight) or (nativeId.endswith("nightlight") and self.has_nightlight):
            return self.get_or_create_light()
        if nativeId.endswith("vss") and self.has_siren:
            return self.get_or_create_vss()
        return None

    def get_or_create_light(self) -> ArloSpotlight:
        if self.has_spotlight:
            light_id = f'{self.arlo_device["deviceId"]}.spotlight'
            if not self.light:
                self.light = ArloSpotlight(light_id, self.arlo_device, self.arlo_basestation, self.provider, self)
        elif self.has_floodlight:
            light_id = f'{self.arlo_device["deviceId"]}.floodlight'
            if not self.light:
                self.light = ArloFloodlight(light_id, self.arlo_device, self.arlo_basestation, self.provider, self)
        elif self.has_nightlight:
            light_id = f'{self.arlo_device["deviceId"]}.nightlight'
            if not self.light:
                self.light = ArloNightlight(light_id, self.arlo_device, self.provider, self)
        return self.light

    def get_or_create_vss(self) -> ArloSirenVirtualSecuritySystem:
        if self.has_siren:
            vss_id = f'{self.arlo_device["deviceId"]}.vss'
            if not self.vss:
                self.vss = ArloSirenVirtualSecuritySystem(vss_id, self.arlo_device, self.arlo_basestation, self.provider, self)
        return self.vss


class ArloCameraWebRTCIntercomSession(ArloCameraIntercomSession):
    def __init__(self, camera: ArloCamera) -> None:
        super().__init__(camera)

        self.arlo_pc = None
        self.arlo_sdp_answered = False

        self.intercom_ffmpeg_subprocess = None

        self.stop_subscriptions = False
        self.start_sdp_answer_subscription()
        self.start_candidate_answer_subscription()

    def __del__(self) -> None:
        self.stop_subscriptions = True
        self.cancel_pending_tasks()

    def start_sdp_answer_subscription(self) -> None:
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

    def start_candidate_answer_subscription(self) -> None:
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

    @async_print_exception_guard
    async def initialize_push_to_talk(self, media: MediaObject) -> None:
        self.logger.info("Initializing push to talk")

        session_id, ice_servers = self.provider.arlo.StartPushToTalk(self.arlo_basestation, self.arlo_device)
        self.logger.debug(f"Received ice servers: {[ice['url'] for ice in ice_servers]}")

        ice_servers = scrypted_arlo_go.Slice_webrtc_ICEServer([
            scrypted_arlo_go.NewWebRTCICEServer(
                scrypted_arlo_go.go.Slice_string([ice['url']]),
                ice.get('username', ''),
                ice.get('credential', '')
            )
            for ice in ice_servers
        ])

        self.arlo_pc = scrypted_arlo_go.NewWebRTCManager(self.camera.logger_server_port, ice_servers)

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
            "-acodec", "libopus",
            "-flags", "+global_header",
            "-vbr", "off",
            "-ar", "48k",
            "-b:a", "32k",
            "-bufsize", "96k",
            "-ac", "2",
            "-application", "lowdelay",
            "-dn", "-sn", "-vn",
            "-frame_duration", "20",
            "-f", "rtp",
            "-flush_packets", "1",
            f"rtp://localhost:{audio_port}?pkt_size={scrypted_arlo_go.UDP_PACKET_SIZE()}",
        ]
        self.logger.debug(f"Starting ffmpeg at {ffmpeg_path} with '{' '.join(ffmpeg_args)}'")

        self.intercom_ffmpeg_subprocess = HeartbeatChildProcess("FFmpeg", self.camera.logger_server_port, ffmpeg_path, *ffmpeg_args)
        self.intercom_ffmpeg_subprocess.start()

        self.sdp_answered = False

        offer = self.arlo_pc.CreateOffer()
        offer_sdp = scrypted_arlo_go.WebRTCSessionDescriptionSDP(offer)
        self.logger.info(f"Arlo offer sdp:\n{offer_sdp}")

        self.arlo_pc.SetLocalDescription(offer)

        self.provider.arlo.NotifyPushToTalkSDP(
            self.arlo_basestation, self.arlo_device,
            session_id, offer_sdp
        )

        def trickle_candidates():
            count = 0
            try:
                while True:
                    candidate = self.arlo_pc.GetNextICECandidate()
                    candidate = scrypted_arlo_go.WebRTCICECandidateInit(
                        scrypted_arlo_go.WebRTCICECandidate(handle=candidate.handle).ToJSON()
                    ).Candidate
                    self.logger.debug(f"Sending candidate to Arlo: {candidate}")
                    self.provider.arlo.NotifyPushToTalkCandidate(
                        self.arlo_basestation, self.arlo_device,
                        session_id, candidate,
                    )
                    count += 1
            except RuntimeError as e:
                if str(e) == "no more candidates":
                    self.logger.debug(f"End of candidates, found {count} candidate(s)")
                else:
                    self.logger.exception("Exception while processing trickle candidates")
            except Exception:
                self.logger.exception("Exception while processing trickle candidates")

        # we can trickle candidates asynchronously so the caller to startIntercom
        # knows we are ready to receive packets
        threading.Thread(target=trickle_candidates).start()

    @async_print_exception_guard
    async def shutdown(self) -> None:
        if self.intercom_ffmpeg_subprocess is not None:
            self.intercom_ffmpeg_subprocess.stop()
            self.intercom_ffmpeg_subprocess = None
        if self.arlo_pc is not None:
            self.arlo_pc.Close()
            self.arlo_pc = None


class ArloCameraSIPIntercomSession(ArloCameraIntercomSession):
    def __init__(self, camera: ArloCamera) -> None:
        super().__init__(camera)

        self.arlo_sip = None
        self.intercom_ffmpeg_subprocess = None

    @async_print_exception_guard
    async def initialize_push_to_talk(self, media: MediaObject) -> None:
        self.logger.info("Initializing push to talk")

        sip_info = self.provider.arlo.GetSIPInfo()
        sip_call_info = sip_info["sipCallInfo"]

        # though GetSIPInfo returns ice servers, there doesn't seem to be any indication
        # that they are used on the arlo web dashboard, so just use what Chrome inserts
        ice_servers = [{"url": "stun:stun.l.google.com:19302"}]
        self.logger.debug(f"Will use ice servers: {[ice['url'] for ice in ice_servers]}")

        ice_servers = scrypted_arlo_go.Slice_webrtc_ICEServer([
            scrypted_arlo_go.NewWebRTCICEServer(
                scrypted_arlo_go.go.Slice_string([ice['url']]),
                ice.get('username', ''),
                ice.get('credential', '')
            )
            for ice in ice_servers
        ])
        sip_cfg = scrypted_arlo_go.SIPInfo(
            DeviceID=self.camera.nativeId,
            CallerURI=f"sip:{sip_call_info['id']}@{sip_call_info['domain']}:{sip_call_info['port']}",
            CalleeURI=sip_call_info['calleeUri'],
            Password=sip_call_info['password'],
            UserAgent="SIP.js/0.20.1",
            WebsocketURI="wss://livestream-z2-prod.arlo.com:7443",
            WebsocketOrigin="https://my.arlo.com",
            WebsocketHeaders=scrypted_arlo_go.HeadersMap({"User-Agent": USER_AGENTS["arlo"]}),
        )

        self.arlo_sip = scrypted_arlo_go.NewSIPWebRTCManager(self.camera.logger_server_port, ice_servers, sip_cfg)

        ffmpeg_params = json.loads(await scrypted_sdk.mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput.value))
        self.logger.debug(f"Received ffmpeg params: {ffmpeg_params}")
        audio_port = self.arlo_sip.InitializeAudioRTPListener(scrypted_arlo_go.WebRTCMimeTypeOpus)

        ffmpeg_path = await scrypted_sdk.mediaManager.getFFmpegPath()
        ffmpeg_args = [
            "-y",
            "-hide_banner",
            "-loglevel", "error",
            "-analyzeduration", "0",
            "-fflags", "-nobuffer",
            "-probesize", "500000",
            *ffmpeg_params["inputArguments"],
            "-acodec", "libopus",
            "-flags", "+global_header",
            "-vbr", "off",
            "-ar", "48k",
            "-b:a", "32k",
            "-bufsize", "96k",
            "-ac", "2",
            "-application", "lowdelay",
            "-dn", "-sn", "-vn",
            "-frame_duration", "20",
            "-f", "rtp",
            "-flush_packets", "1",
            f"rtp://localhost:{audio_port}?pkt_size={scrypted_arlo_go.UDP_PACKET_SIZE()}",
        ]
        self.logger.debug(f"Starting ffmpeg at {ffmpeg_path} with '{' '.join(ffmpeg_args)}'")

        self.intercom_ffmpeg_subprocess = HeartbeatChildProcess("FFmpeg", self.camera.logger_server_port, ffmpeg_path, *ffmpeg_args)
        self.intercom_ffmpeg_subprocess.start()

        def sip_start():
            try:
                self.arlo_sip.Start()
            except Exception:
                self.logger.exception("Exception starting sip call")

        # do remaining setup asynchronously so the caller to startIntercom
        # can start sending packets
        threading.Thread(target=sip_start).start()

    @async_print_exception_guard
    async def shutdown(self) -> None:
        if self.intercom_ffmpeg_subprocess is not None:
            self.intercom_ffmpeg_subprocess.stop()
            self.intercom_ffmpeg_subprocess = None
        if self.arlo_sip is not None:
            self.arlo_sip.Close()
            self.arlo_sip = None