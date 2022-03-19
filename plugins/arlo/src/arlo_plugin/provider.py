from arlo import Arlo
import asyncio
import base64
import binascii
import json
import os
import tempfile

import scrypted_sdk
from scrypted_sdk.types import Settings, DeviceProvider, DeviceDiscovery, ScryptedInterface, ScryptedDeviceType

from .camera import ArloCamera
from .logging import getLogger
from .scrypted_env import getPyPluginSettingsFile, ensurePyPluginSettingsFile

logger = getLogger(__name__)

class ArloProvider(scrypted_sdk.ScryptedDeviceBase, Settings, DeviceProvider, DeviceDiscovery):
    _scrypted_devices = {}
    _arlo_devices = {}
    _settings = None
    _arlo = None

    def __init__(self, nativeId=None):
        if nativeId is None:
            managerNativeIds = scrypted_sdk.deviceManager.nativeIds
            logger.info(f"No nativeId provided, selecting None key from: { {k: v.id for k, v in managerNativeIds.items()} }")
            nativeId = managerNativeIds[None].id
        super().__init__(nativeId=nativeId)

        ensurePyPluginSettingsFile(self.pluginId)
        self._load_arlo()

        asyncio.get_event_loop().create_task(self.discoverDevices(0))

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
        if self._arlo is not None:
            return self._arlo
        return self._load_arlo()
    
    def _load_arlo(self):
        if self.arlo_username == "" or \
            self.arlo_password == "" or \
            self.arlo_gmail_credentials_b64 == "":
            return None

        self._arlo_devices = {}

        logger.info("Trying to initialize Arlo client...")
        try:
            credFileContents = base64.b64decode(self.arlo_gmail_credentials_b64)

            with tempfile.TemporaryDirectory() as credDir:
                credFilePath = os.path.join(credDir, "credentials")
                with open(credFilePath, 'wb') as credFile:
                    credFile.write(credFileContents)

                self._arlo = Arlo(self.arlo_username, self.arlo_password, credFilePath)
        except Exception as e:
            logger.error(f"Error initializing Arlo client: {type(e)} with message {str(e)}")
            return None
        logger.info(f"Initialized Arlo client for {self.arlo_username}")

        return self._arlo

    @property
    def scrypted_devices(self):
        return self._scrypted_devices

    @property
    def arlo_devices(self):
        return self._arlo_devices

    def saveSettings(self):
        with open(getPyPluginSettingsFile(self.pluginId), 'w') as file:
            file.write(json.dumps(self._settings))

        # force arlo client to be invalidated and reloaded
        self._arlo = None
        self._load_arlo()
        asyncio.get_event_loop().create_task(self.discoverDevices(0))

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

    async def discoverDevices(self, duration):
        if not self.arlo:
            raise Exception("Arlo client not connected, cannot discover devices")

        logger.info("Discovering devices...")

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
                    #ScryptedInterface.VideoCamera.value,
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
        print("GETTING DEVICE", nativeId)
        ret = self.scrypted_devices.get(nativeId, None)
        if ret is None:
            ret = self.createCamera(nativeId)
            if ret is not None:
                self.scrypted_devices[nativeId] = ret
        return ret

    def createCamera(self, nativeId):
        return ArloCamera(nativeId, self.arlo_devices[nativeId], self)