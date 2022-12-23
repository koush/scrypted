import asyncio

import scrypted_sdk
from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import Camera, VideoCamera, Intercom, MotionSensor, Battery, DeviceProvider, ScryptedDevice, ScryptedMimeTypes, ScryptedInterface, ScryptedDeviceType

from .logging import ScryptedDeviceLoggerMixin
from .util import BackgroundTaskMixin


class ArloCamera(ScryptedDeviceBase, Camera, VideoCamera, Intercom, MotionSensor, Battery, DeviceProvider, ScryptedDeviceLoggerMixin, BackgroundTaskMixin):
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

        self.speaker = None

        self.create_task(self.discoverDevices())

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

    async def stopIntercom(self):
        self.logger.info("Stopping intercom")
        real_speaker = await self.speaker.real_speaker()
        await real_speaker.stopIntercom()
        self.speaker.close()

    def _update_device_details(self, arlo_device):
        """For updating device details from the Arlo dictionary retrieved from Arlo's REST API.
        """
        self.batteryLevel = arlo_device["properties"].get("batteryLevel")


class ArloCameraSpeaker(ScryptedDeviceBase, ScryptedDevice, ScryptedDeviceLoggerMixin, BackgroundTaskMixin):
    def __init__(self, nativeId, arlo_device, arlo_basestation, provider):
        super().__init__(nativeId=nativeId)

        self.logger_name = f"{nativeId}"

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
        self.sdp_sent = False
        self.sdp_answered = False
        self.candidate_answered = set()

    def __del__(self):
        self.stop_subscriptions = True

    def start_sdp_answer_subscription(self):
        def callback(sdp):
            if self.rtc_session and not self.sdp_answered:
                if "a=mid:" not in sdp:
                    # arlo appears to not return a mux id in the response, which
                    # doesn't play nicely with our webrtc peers. let's add it
                    sdp += "a=mid:0av\r\n"
                self.logger.info(f"Arlo response sdp:\n{sdp}")
                
                self.create_task(self.rtc_session.setRemoteDescription(
                    { "sdp": sdp, "type": "answer" },
                    self.rtc_setup
                ))

                self.sdp_answered = True
            return self.stop_subscriptions

        self.register_task(
            self.provider.arlo.SubscribeToSDPAnswers(self.arlo_basestation, self.arlo_device, callback)
        )

    def start_candidate_answer_subscription(self):
        def callback(candidate):
            if self.rtc_session:
                prefix = "a="
                if candidate.startswith(prefix):
                    # arlo returns a= in the candidate, which we should remove
                    candidate = candidate[len(prefix):]

                candidate = candidate.strip()

                if candidate in self.candidate_answered:
                    # we sometimes see duplicated responses from arlo. could be
                    # something on their end, or could be the nature of how we
                    # use eventstream/mqtt. filter duplicates out here
                    return self.stop_subscriptions
                self.candidate_answered.add(candidate)

                self.logger.info(f"Arlo response candidate: {candidate}")

                self.create_task(self.rtc_session.addIceCandidate(
                    { "candidate": candidate, "sdpMid": "0av", "sdpMLineIndex": 0 }
                ))
            return self.stop_subscriptions

        self.register_task(
            self.provider.arlo.SubscribeToCandidateAnswers(self.arlo_basestation, self.arlo_device, callback)
        )

    async def startRTCSignalingSession(self, session):
        self.logger.info("Starting RTC signaling")

        try:
            self.rtc_session = session
            self.sdp_answered = False
            self.sdp_sent = False
            self.candidate_answered = set()
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
                try:
                    while not self.sdp_sent:
                        await asyncio.sleep(0.01)
                    self.logger.info(f"Arlo offer candidate: {candidate['candidate']}")
                    self.provider.arlo.NotifyPushToTalkCandidate(self.arlo_basestation, self.arlo_device, session_id, candidate['candidate'])
                    self.logger.info("Candidate sent")
                except Exception as e:
                    self.logger.error(e)

            offer = await session.createLocalDescription("offer", self.rtc_setup, on_ice_candidate)
            self.logger.info(f"Arlo offer sdp:\n{offer['sdp']}")

            self.provider.arlo.NotifyPushToTalkSDP(self.arlo_basestation, self.arlo_device, session_id, offer["sdp"])
            self.sdp_sent = True

            return ArloCameraSpeakerSessionControl(self)
        except Exception as e:
            self.logger.error(e, exc_info=True)

    async def real_speaker(self):
        return await scrypted_sdk.systemManager.api.getDeviceById(self.getScryptedProperty("id"))

    def close(self):
        self.logger.info("Closing speaker session")
        self.rtc_session = None
        self.rtc_setup = None
        self.sdp_sent = False
        self.sdp_answered = False
        self.candidate_answered = set()


class ArloCameraSpeakerSessionControl:
    def __init__(self, speaker):
        self.speaker = speaker

    async def endSession(self):
        self.speaker.close()