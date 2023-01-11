import asyncio
import json
import logging
import requests

import scrypted_sdk
from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import Settings, DeviceProvider, DeviceDiscovery, ScryptedInterface, ScryptedDeviceType

from .arlo import Arlo
from .arlo.arlo_async import change_stream_class
from .arlo.logging import logger as arlo_lib_logger
from .camera import ArloCamera
from .doorbell import ArloDoorbell
from .logging import ScryptedDeviceLoggerMixin 
from .util import BackgroundTaskMixin
from .rtcpeerconnection import logger as background_rtc_logger


class ArloProvider(ScryptedDeviceBase, Settings, DeviceProvider, DeviceDiscovery, ScryptedDeviceLoggerMixin, BackgroundTaskMixin):
    arlo_cameras = None
    arlo_basestations = None
    _arlo_mfa_code = None
    scrypted_devices = None
    _arlo = None
    _arlo_mfa_complete_auth = None

    plugin_verbosity_choices = {
        "Few": logging.WARNING,
        "Normal": logging.INFO,
        "Verbose": logging.DEBUG
    }

    arlo_transport_choices = ["MQTT", "SSE"]

    def __init__(self, nativeId=None):
        super().__init__(nativeId=nativeId)
        self.logger_name = "provider"

        self.arlo_cameras = {}
        self.arlo_basestations = {}
        self.scrypted_devices = {}

        self.propagate_verbosity()
        self.propagate_transport()

        def load(self):
            _ = self.arlo
        asyncio.get_event_loop().call_soon(load, self)

    @property
    def arlo_username(self):
        return self.storage.getItem("arlo_username")

    @property
    def arlo_password(self):
        return self.storage.getItem("arlo_password")

    @property
    def arlo_auth_headers(self):
        return self.storage.getItem("arlo_auth_headers")

    @property
    def arlo_user_id(self):
        return self.storage.getItem("arlo_user_id")

    @property
    def arlo_transport(self):
        transport = self.storage.getItem("arlo_transport")
        if transport is None:
            transport = "SSE"
            self.storage.setItem("arlo_transport", transport)
        return transport

    @property
    def plugin_verbosity(self):
        verbosity = self.storage.getItem("plugin_verbosity")
        if verbosity is None:
            verbosity = "Normal"
            self.storage.setItem("plugin_verbosity", verbosity)
        return verbosity

    @property
    def arlo(self):
        if self._arlo is not None:
            if self._arlo_mfa_complete_auth is not None:
                if self._arlo_mfa_code == "":
                    return None

                self.logger.info("Completing Arlo MFA...")
                self._arlo_mfa_complete_auth(self._arlo_mfa_code)
                self._arlo_mfa_complete_auth = None 
                self._arlo_mfa_code = None
                self.logger.info("Arlo MFA done")

                self.storage.setItem("arlo_auth_headers", json.dumps(dict(self._arlo.request.session.headers.items())))
                self.storage.setItem("arlo_user_id", self._arlo.user_id)

                self.create_task(self.do_arlo_setup())

            return self._arlo

        if not self.arlo_username or not self.arlo_password:
            return None
            
        self.logger.info("Trying to initialize Arlo client...")
        try:
            self._arlo = Arlo(self.arlo_username, self.arlo_password)
            headers = self.arlo_auth_headers
            if headers:
                self._arlo.UseExistingAuth(self.arlo_user_id, json.loads(headers))
                self.logger.info(f"Initialized Arlo client, reusing stored auth headers")

                self.create_task(self.do_arlo_setup())
                return self._arlo
            else:
                self._arlo_mfa_complete_auth = self._arlo.LoginMFA()
                self.logger.info(f"Initialized Arlo client, waiting for MFA code")
                return None
        except Exception as e:
            self.logger.error(f"Error initializing Arlo client: {type(e)} with message {str(e)}")
            self._arlo = None
            self._arlo_mfa_code = None
            return None

    async def do_arlo_setup(self):
        try:
            await self.discoverDevices()
            await self.arlo.Subscribe([
                (self.arlo_basestations[camera["parentId"]], camera) for camera in self.arlo_cameras.values()
            ])

            for nativeId in self.arlo_cameras.keys():
                self.getDevice(nativeId)
        except requests.exceptions.HTTPError as e:
            self.logger.error(f"HTTPError '{str(e)}' while performing post-login Arlo setup, will retry with fresh login")
            self._arlo = None
            self._arlo_mfa_code = None
            self.storage.setItem("arlo_auth_headers", None)
            _ = self.arlo
        except Exception as e:
            self.logger.error(f"Error performing post-login Arlo setup: {type(e)} with message {str(e)}")

    def invalidate_arlo_client(self):
        if self.arlo is not None:
            self._arlo.Unsubscribe()
        self._arlo = None
        self._arlo_mfa_code = None
        self._arlo_mfa_complete_auth = None
        self.storage.setItem("arlo_auth_headers", "")
        self.storage.setItem("arlo_user_id", "")

    def get_current_log_level(self):
        return ArloProvider.plugin_verbosity_choices[self.plugin_verbosity]

    def propagate_verbosity(self):
        self.print(f"Setting plugin verbosity to {self.plugin_verbosity}")
        log_level = self.get_current_log_level()
        self.logger.setLevel(log_level)
        for _, device in self.scrypted_devices.items():
            device.logger.setLevel(log_level)
        arlo_lib_logger.setLevel(log_level)
        background_rtc_logger.setLevel(log_level)

    def propagate_transport(self):
        self.print(f"Setting plugin transport to {self.arlo_transport}")
        change_stream_class(self.arlo_transport)

    async def getSettings(self):
        return [
            {
                "key": "arlo_username",
                "title": "Arlo Username",
                "value": self.arlo_username,
            },
            {
                "key": "arlo_password",
                "title": "Arlo Password",
                "type": "password",
                "value": self.arlo_password,
            },
            {
                "key": "arlo_mfa_code",
                "title": "Two Factor Code",
                "description": "Enter the code sent by Arlo to your email or phone number.",
            },
            {
                "key": "force_reauth",
                "title": "Force Re-Authentication",
                "description": "Resets the authentication flow of the plugin. Will also re-do 2FA.",
                "value": "No",
                "choices": ["No", "Yes"],
            },
            {
                "key": "arlo_transport",
                "title": "Underlying Transport Protocol",
                "description": "Select the underlying transport protocol used to connect to Arlo Cloud.",
                "value": self.arlo_transport,
                "choices": self.arlo_transport_choices,
            },
            {
                "key": "plugin_verbosity",
                "title": "Plugin Verbosity",
                "description": "Select the verbosity of this plugin. 'Few' will only show warnings and errors. 'Verbose' will show debugging messages, including events received from connected Arlo cameras.",
                "value": self.plugin_verbosity,
                "choices": sorted(self.plugin_verbosity_choices.keys()),
            },
        ]

    async def putSetting(self, key, value):
        if key == "arlo_mfa_code":
            self._arlo_mfa_code = value
        elif key == "force_reauth":
            # force arlo client to be invalidated and reloaded
            self.invalidate_arlo_client()
        else:
            self.storage.setItem(key, value)

            if key == "plugin_verbosity":
                self.propagate_verbosity()
            elif key == "arlo_transport":
                self.propagate_transport()
                # force arlo client to be invalidated and reloaded, but
                # keep any mfa codes
                if self.arlo is not None:
                    self._arlo.Unsubscribe()
                    self._arlo = None
            else:
                # force arlo client to be invalidated and reloaded
                self.invalidate_arlo_client()

        # initialize Arlo client or continue MFA
        _ = self.arlo
        await self.onDeviceEvent(ScryptedInterface.Settings.value, None)

    async def discoverDevices(self, duration=0):
        if not self.arlo:
            raise Exception("Arlo client not connected, cannot discover devices")

        self.logger.info("Discovering devices...")
        self.arlo_cameras = {}
        self.arlo_basestations = {}
        self.scrypted_devices = {}

        basestations = self.arlo.GetDevices(['basestation', 'siren'])
        for basestation in basestations:
            self.arlo_basestations[basestation["deviceId"]] = basestation
        self.logger.info(f"Discovered {len(basestations)} basestations")

        devices = []
        cameras = self.arlo.GetDevices(['camera', "arloq", "arloqs", "doorbell"])
        for camera in cameras:
            if camera["deviceId"] != camera["parentId"] and camera["parentId"] not in self.arlo_basestations:
                self.logger.info(f"Skipping camera {camera['deviceId']} because its basestation was not found")
                continue

            device = {
                "info": {
                    "model": f"{camera['properties']['modelId']} ({camera['properties'].get('hwVersion', '')})".strip(),
                    "manufacturer": "Arlo",
                    "firmware": camera.get("firmwareVersion"),
                    "serialNumber": camera["deviceId"],
                },
                "nativeId": camera["deviceId"],
                "name": camera["deviceName"],
                "interfaces": self.get_interfaces(camera),
                "type": ScryptedDeviceType.Camera.value,
                "providerNativeId": self.nativeId,
            }

            devices.append(device)

            if camera["deviceId"] == camera["parentId"]:
                self.arlo_basestations[camera["deviceId"]] = camera

            nativeId = camera["deviceId"]
            self.arlo_cameras[nativeId] = camera

        await scrypted_sdk.deviceManager.onDevicesChanged({
            "devices": devices,
        })

        if len(cameras) != len(devices):
            self.logger.info(f"Discovered {len(cameras)} cameras, but only {len(devices)} are usable")
        else:
            self.logger.info(f"Discovered {len(cameras)} cameras")

    def getDevice(self, nativeId):
        ret = self.scrypted_devices.get(nativeId, None)
        if ret is None:
            ret = self.createCamera(nativeId)
            if ret is not None:
                self.scrypted_devices[nativeId] = ret
        return ret

    def createCamera(self, nativeId):
        if nativeId not in self.arlo_cameras:
            return None
        arlo_camera = self.arlo_cameras[nativeId]

        if arlo_camera["parentId"] not in self.arlo_basestations:
            return None
        arlo_basestation = self.arlo_basestations[arlo_camera["parentId"]]

        if arlo_camera["deviceType"] == "doorbell":
            return ArloDoorbell(nativeId, arlo_camera, arlo_basestation, self)
        else:
            return ArloCamera(nativeId, arlo_camera, arlo_basestation, self)

    def get_interfaces(self, camera):
        model_id = camera['properties']['modelId'].lower()
        self.logger.debug(f"Checking applicable scrypted interfaces for {model_id}")

        results = [
            ScryptedInterface.VideoCamera.value,
            ScryptedInterface.Camera.value,
            ScryptedInterface.MotionSensor.value,
            ScryptedInterface.Intercom.value,
            ScryptedInterface.Battery.value,
        ]

        if model_id.startswith("avd1001"):
            results.remove(ScryptedInterface.Battery.value)

        if camera['deviceType'] == 'doorbell':
            results.append(ScryptedInterface.BinarySensor.value)

        if camera["deviceId"] == camera["parentId"]:
            results.remove(ScryptedInterface.Intercom.value)
 
        return results