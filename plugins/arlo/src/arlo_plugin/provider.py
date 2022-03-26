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
from .scrypted_env import getPyPluginSettingsFile, ensurePyPluginSettingsFile

logger = getLogger(__name__)

class ArloProvider(scrypted_sdk.ScryptedDeviceBase, Settings, DeviceProvider, DeviceDiscovery):
    arlo_devices = None 
    scrypted_devices = None
    _settings = None
    _arlo = None
    _arlo_lock = None

    def __init__(self, nativeId=None):
        if nativeId is None:
            mgr_native_ids = scrypted_sdk.deviceManager.nativeIds
            logger.info(f"No nativeId provided, selecting 'None' key from: { {k: v.id for k, v in mgr_native_ids.items()} }")
            nativeId = mgr_native_ids[None].id
        super().__init__(nativeId=nativeId)

        self.arlo_devices = {}
        self.scrypted_devices = {}

        ensurePyPluginSettingsFile(self.pluginId)

        async def initialLoad(self):
            _ = self.arlo 
            await self.discoverDevices()
        asyncio.get_event_loop().create_task(initialLoad(self))

    @property
    def pluginId(self):
        return scrypted_sdk.remote.pluginId

    @property
    def settings(self):
        if self._settings is not None:
            return self._settings

        filePath = getPyPluginSettingsFile(self.pluginId)
        self._settings = json.loads(open(filePath).read())
        return self._settings

    @property
    def arlo_username(self):
        return self.settings.get("arlo_username", "")

    @property
    def arlo_password(self):
        return self.settings.get("arlo_password", "")

    @property
    def arlo_gmail_credentials_b64(self):
        return self.settings.get("arlo_gmail_credentials_b64", "")

    @property
    def arlo(self):
        if self._arlo is None:
            self._arlo = self._load_arlo()
        return self._arlo
    
    def _load_arlo(self, retry=True):
        if self.arlo_username == "" or \
            self.arlo_password == "" or \
            self.arlo_gmail_credentials_b64 == "":
            return None

        arlo = None
        logger.info("Trying to initialize Arlo client...")
        try:
            cred_file_contents = base64.b64decode(self.arlo_gmail_credentials_b64)

            with tempfile.TemporaryDirectory() as cred_dir:
                cred_file_path = os.path.join(cred_dir, "credentials")
                with open(cred_file_path, 'wb') as cred_file:
                    cred_file.write(cred_file_contents)

                arlo = Arlo(self.arlo_username, self.arlo_password, cred_file_path)
        except Exception as e:
            logger.error(f"Error initializing Arlo client: {type(e)} with message {str(e)}")
            if retry:
                return self._load_arlo(retry=False)
            return None
        logger.info(f"Initialized Arlo client for {self.arlo_username}")

        return arlo

    def saveSettings(self):
        with open(getPyPluginSettingsFile(self.pluginId), 'w') as file:
            file.write(json.dumps(self._settings))

        # force arlo client to be invalidated and reloaded
        async def reloadArlo(self):
            if self._arlo is not None:
                self._arlo.Unsubscribe()
                self._arlo = self._load_arlo()
            await self.discoverDevices()
        asyncio.get_event_loop().create_task(reloadArlo(self))

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
                "key": "arlo_gmail_credentials_b64",
                "title": "Base64-Encoded Google Credentials File (for MFA)",
                "type": "password",
                "value": self.arlo_gmail_credentials_b64,
            },
        ]

    async def putSetting(self, key, value):
        self.settings[key] = value
        self.saveSettings()
        await self.onDeviceEvent(ScryptedInterface.Settings.value, None)

    async def discoverDevices(self, duration=0):
        if not self.arlo:
            raise Exception("Arlo client not connected, cannot discover devices")

        logger.info("Discovering devices...")
        self.arlo_devices = {}
        self.scrypted_devices = {}

        cameras = self.arlo.GetDevices('camera')
        devices = []
        for camera in cameras:
            device = {
                "info": {
                    "model": f"{camera['properties']['modelId']} ({camera['properties']['hwVersion']})",
                    "manufacturer": "Arlo",
                    "firmware": camera["firmwareVersion"],
                    "serialNumber": camera["deviceId"],
                },
                "nativeId": camera["uniqueId"],
                "name": camera["deviceName"],
                "interfaces": [
                    ScryptedInterface.VideoCamera.value,
                    ScryptedInterface.Camera.value
                ],
                "type": ScryptedDeviceType.Camera.value,
                "providerNativeId": self.nativeId,
            }
            devices.append(device)

            nativeId = camera["uniqueId"]
            self.arlo_devices[nativeId] = camera
            self.getDevice(nativeId)

        await scrypted_sdk.deviceManager.onDevicesChanged({
            "devices": devices,
        })

        logger.info(f"Discovered {len(cameras)} devices")

    def getDevice(self, nativeId):
        ret = self.scrypted_devices.get(nativeId, None)
        if ret is None:
            ret = self.createCamera(nativeId)
            if ret is not None:
                self.scrypted_devices[nativeId] = ret
        return ret

    def createCamera(self, nativeId):
        return ArloCamera(nativeId, self.arlo_devices[nativeId], self)