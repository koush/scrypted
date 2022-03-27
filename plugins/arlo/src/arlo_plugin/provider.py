import asyncio
import base64
import json
import os
import tempfile

import scrypted_sdk
from scrypted_sdk.types import Settings, DeviceProvider, DeviceDiscovery, ScryptedInterface, ScryptedDeviceType

from .arlo import Arlo
from .camera import ArloCamera
from .logging import getLogger
from .scrypted_env import get_pyplugin_settings_file, ensure_pyplugin_settings_file

logger = getLogger(__name__)

class ArloProvider(scrypted_sdk.ScryptedDeviceBase, Settings, DeviceProvider, DeviceDiscovery):
    arlo_cameras = None
    arlo_basestations = None
    _arlo_mfa_code = None
    scrypted_devices = None
    _settings = None
    _arlo = None
    _arlo_lock = None
    _arlo_mfa_complete_auth = None

    def __init__(self, nativeId=None):
        if nativeId is None:
            mgr_native_ids = scrypted_sdk.deviceManager.nativeIds
            logger.info(f"No nativeId provided, selecting 'None' key from: { {k: v.id for k, v in mgr_native_ids.items()} }")
            nativeId = mgr_native_ids[None].id
        super().__init__(nativeId=nativeId)

        self.arlo_cameras = {}
        self.arlo_basestations = {}
        self.scrypted_devices = {}

        ensure_pyplugin_settings_file(self.pluginId)

    @property
    def pluginId(self):
        return scrypted_sdk.remote.pluginId

    @property
    def settings(self):
        if self._settings is not None:
            return self._settings

        file_path = get_pyplugin_settings_file(self.pluginId)
        self._settings = json.loads(open(file_path).read())
        return self._settings

    @property
    def arlo_username(self):
        return self.settings.get("arlo_username", "")

    @property
    def arlo_password(self):
        return self.settings.get("arlo_password", "")

    @property
    def arlo(self):
        if self._arlo is not None:
            if self._arlo_mfa_complete_auth is not None:
                if self._arlo_mfa_code == "":
                    return None

                logger.info("Completing Arlo MFA...")
                self._arlo_mfa_complete_auth(self._arlo_mfa_code)
                self._arlo_mfa_complete_auth = None 
                self._arlo_mfa_code = None
                logger.info("Arlo MFA done")
                asyncio.get_event_loop().create_task(self.discoverDevices())

            return self._arlo

        if self.arlo_username == "" or self.arlo_password == "":
            return None
            
        logger.info("Trying to initialize Arlo client...")
        try:
            self._arlo = Arlo()
            self._arlo_mfa_complete_auth = self._arlo.LoginMFA(self.arlo_username, self.arlo_password)
        except Exception as e:
            logger.error(f"Error initializing Arlo client: {type(e)} with message {str(e)}")
            self._arlo = None
            self._arlo_mfa_code = None
            return None
        logger.info(f"Initialized Arlo client for {self.arlo_username}, waiting for MFA code")

        return None

    def save_settings(self):
        with open(get_pyplugin_settings_file(self.pluginId), 'w') as file:
            file.write(json.dumps(self._settings))

    async def getSettings(self):
        _ = self.arlo
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
        ]

    async def putSetting(self, key, value):
        if key == "arlo_mfa_code":
            self._arlo_mfa_code = value
        else:
            self.settings[key] = value
            self.save_settings()

            # force arlo client to be invalidated and reloaded
            if self.arlo is not None:
                self._arlo.Unsubscribe()
                self._arlo = None
                self._arlo_mfa_code = None
                self._arlo_mfa_complete_auth = None

        # initialize Arlo client or continue MFA
        _ = self.arlo
        await self.onDeviceEvent(ScryptedInterface.Settings.value, None)

    async def discoverDevices(self, duration=0):
        if not self.arlo:
            raise Exception("Arlo client not connected, cannot discover devices")

        logger.debug("Discovering devices...")
        self.arlo_cameras = {}
        self.arlo_basestations = {}
        self.scrypted_devices = {}

        basestations = self.arlo.GetDevices('basestation')
        for basestation in basestations:
            self.arlo_basestations[basestation["deviceId"]] = basestation

        devices = []
        cameras = self.arlo.GetDevices('camera')
        for camera in cameras:
            device = {
                "info": {
                    "model": f"{camera['properties']['modelId']} ({camera['properties']['hwVersion']})",
                    "manufacturer": "Arlo",
                    "firmware": camera["firmwareVersion"],
                    "serialNumber": camera["deviceId"],
                },
                "nativeId": camera["deviceId"],
                "name": camera["deviceName"],
                "interfaces": [
                    ScryptedInterface.VideoCamera.value,
                    ScryptedInterface.Camera.value
                ],
                "type": ScryptedDeviceType.Camera.value,
                "providerNativeId": self.nativeId,
            }
            devices.append(device)

            if camera["deviceId"] == camera["parentId"]:
                self.arlo_basestations[camera["deviceId"]] = camera

            nativeId = camera["deviceId"]
            self.arlo_cameras[nativeId] = camera
            self.getDevice(nativeId)

        await scrypted_sdk.deviceManager.onDevicesChanged({
            "devices": devices,
        })

        logger.debug(f"Discovered {len(cameras)} devices")

    def getDevice(self, nativeId):
        ret = self.scrypted_devices.get(nativeId, None)
        if ret is None:
            ret = self.createCamera(nativeId)
            if ret is not None:
                self.scrypted_devices[nativeId] = ret
        return ret

    def createCamera(self, nativeId):
        arlo_camera = self.arlo_cameras[nativeId]
        arlo_basestation = self.arlo_basestations[arlo_camera["parentId"]]
        return ArloCamera(nativeId, arlo_camera, arlo_basestation, self)