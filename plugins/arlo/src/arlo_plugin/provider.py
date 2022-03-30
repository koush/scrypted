import asyncio

import scrypted_sdk
from scrypted_sdk.types import Settings, DeviceProvider, DeviceDiscovery, ScryptedInterface, ScryptedDeviceType

from .arlo import Arlo
from .camera import ArloCamera

class ArloProvider(scrypted_sdk.ScryptedDeviceBase, Settings, DeviceProvider, DeviceDiscovery):
    arlo_cameras = None
    arlo_basestations = None
    _arlo_mfa_code = None
    scrypted_devices = None
    _arlo = None
    _arlo_mfa_complete_auth = None

    def __init__(self, nativeId=None):
        super().__init__(nativeId=nativeId)

        self.arlo_cameras = {}
        self.arlo_basestations = {}
        self.scrypted_devices = {}

    @property
    def arlo_username(self):
        return self.storage.getItem("arlo_username")

    @property
    def arlo_password(self):
        return self.storage.getItem("arlo_password")

    @property
    def arlo(self):
        if self._arlo is not None:
            if self._arlo_mfa_complete_auth is not None:
                if self._arlo_mfa_code == "":
                    return None

                self.print("Completing Arlo MFA...")
                self._arlo_mfa_complete_auth(self._arlo_mfa_code)
                self._arlo_mfa_complete_auth = None 
                self._arlo_mfa_code = None
                self.print("Arlo MFA done")
                asyncio.get_event_loop().create_task(self.discoverDevices())

            return self._arlo

        if self.arlo_username is None or self.arlo_password is None:
            return None
            
        self.print("Trying to initialize Arlo client...")
        try:
            self._arlo = Arlo()
            self._arlo_mfa_complete_auth = self._arlo.LoginMFA(self.arlo_username, self.arlo_password)
        except Exception as e:
            self.print(f"Error initializing Arlo client: {type(e)} with message {str(e)}")
            self._arlo = None
            self._arlo_mfa_code = None
            return None
        self.print(f"Initialized Arlo client for {self.arlo_username}, waiting for MFA code")

        return None

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
            self.storage.setItem(key, value)

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

        self.print("Discovering devices...")
        self.arlo_cameras = {}
        self.arlo_basestations = {}
        self.scrypted_devices = {}

        basestations = self.arlo.GetDevices('basestation')
        for basestation in basestations:
            self.arlo_basestations[basestation["deviceId"]] = basestation
        self.print(f"Discovered {len(basestations)} basestations")

        devices = []
        cameras = self.arlo.GetDevices('camera')
        for camera in cameras:
            if camera["deviceId"] != camera["parentId"] and camera["parentId"] not in self.arlo_basestations:
                self.print(f"Skipping camera {camera['deviceId']} because its basestation was not found")
                continue

            device = {
                "info": {
                    "model": f"{camera['properties']['modelId']} ({camera['properties']['hwVersion']})",
                    "manufacturer": "Arlo",
                    "firmware": camera.get("firmwareVersion"),
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

        self.print(f"Discovered {len(cameras)} cameras, but only {len(devices)} are usable")

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

        return ArloCamera(nativeId, arlo_camera, arlo_basestation, self)