from arlo import Arlo
import base64
import binascii
import json
import os
import tempfile

import scrypted_sdk
from scrypted_sdk.types import Settings, DeviceProvider, DeviceCreator, ScryptedInterface, ScryptedDeviceType

from .scrypted_env import getPyPluginSettingsFile, ensurePyPluginSettingsFile

class ArloProvider(scrypted_sdk.ScryptedDeviceBase, Settings, DeviceProvider, DeviceCreator):
    _settings = None
    _arlo = None

    def __init__(self, nativeId=None):
        if nativeId is None:
            managerNativeIds = scrypted_sdk.deviceManager.nativeIds
            print(f"No nativeId provided, selecting None key from: { {k: v.id for k, v in managerNativeIds.items()} }")
            nativeId = managerNativeIds[None].id
        super().__init__(nativeId=nativeId)

        ensurePyPluginSettingsFile(self.pluginId)

        self.arlo

        #for camId in scrypted_sdk.deviceManager.getNativeIds():
        #    if camId is not None:
        #        self.getDevice(camId)

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

        if self.arlo_username == "" or \
            self.arlo_password == "" or \
            self.arlo_gmail_credentials_b64 == "":
            return None

        print("Trying to initialize Arlo client...")
        try:
            credFileContents = base64.b64decode(self.arlo_gmail_credentials_b64)

            with tempfile.TemporaryDirectory() as credDir:
                credFilePath = os.path.join(credDir, "credentials")
                with open(credFilePath, 'wb') as credFile:
                    credFile.write(credFileContents)

                self._arlo = Arlo(self.arlo_username, self.arlo_password, credFilePath)
        except Exception as e:
            print(f"Error initializing Arlo client: {type(e)} with message {str(e)}")
            return None
        print(f"Initialized Arlo client for {self.arlo_username}")

        return self._arlo

    def saveSettings(self):
        with open(getPyPluginSettingsFile(self.pluginId), 'w') as file:
            file.write(json.dumps(self._settings))

        # force arlo client to be invalidated and reloaded
        self._arlo = None
        self.arlo

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
        await self.onDeviceEvent(ScryptedInterface.Settings, None)

    def getDevice(self, nativeId):
        ret = self.devices.get(nativeId, None)
        if ret is None:
            ret = self.createCamera(nativeId)
            if ret is not None:
                self.devices.set(nativeId, ret)
        return ret

    async def createDevice(self, settings):
        nativeId = binascii.b2a_hex(os.urandom(4)).decode("utf-8")
        name = settings["newCamera"]
        await scrypted_sdk.deviceManager.systemManager.api.onDeviceDiscovered({
            "nativeId": nativeId, 
            "name": name, 
            "interfaces": self.getDeviceInterfaces(),
            "type": ScryptedDeviceType.Camera.value,
        })
        print(f"Creating Arlo device named {name} as {nativeId}")
        return nativeId

    async def getCreateDeviceSettings(self):
        return [
            {
                "key": "newCamera",
                "title": "Add Scrypted Camera",
                "placeholder": "Scrypted camera name, can be the same as your Arlo camera name",
            },
            {
                "key": "arloCamera",
                "title": "Target Arlo Camera",
                "placeholder": "Name of target camera in the connected Arlo account",
            },
        ]

    def getDeviceInterfaces(self):
        return [
            ScryptedInterface.VideoCamera.value,
        ]