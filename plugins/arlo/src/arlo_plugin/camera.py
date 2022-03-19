import scrypted_sdk
from scrypted_sdk.types import Settings, Camera, VideoCamera

class ArloCamera(scrypted_sdk.ScryptedDeviceBase, Camera, Settings):
    nativeId = None
    arlo_device = None
    provider = None

    def __init__(self, nativeId, arlo_device, provider):
        super().__init__(nativeId=nativeId)

        self.nativeId = nativeId
        self.arlo_device = arlo_device
        self.provider = provider

    async def getPictureOptions(self):
        return []

    async def takePicture(self, options=None):
        picUrl = self.provider.arlo.TriggerFullFrameSnapshot(self.arlo_device, self.arlo_device)
        a = scrypted_sdk.mediaManager.createMediaObjectFromUrl(picUrl)
        print(a)
        return a