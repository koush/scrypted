import traceback
import asyncio
import scrypted_sdk
from scrypted_sdk import Setting, SettingValue
from typing import Any, List
import gstreamer
import libav
import vipsimage
import pilimage
import time

Gst = None
try:
    from gi.repository import Gst
except:
    pass

av = None
try:
    import av
except:
    pass

class LibavGenerator(scrypted_sdk.ScryptedDeviceBase, scrypted_sdk.VideoFrameGenerator):
    async def generateVideoFrames(self, mediaObject: scrypted_sdk.MediaObject, options: scrypted_sdk.VideoFrameGeneratorOptions = None, filter: Any = None) -> scrypted_sdk.VideoFrame:
        worker = scrypted_sdk.fork()
        forked: CodecFork = await worker.result
        return await forked.generateVideoFramesLibav(mediaObject, options, filter)

class GstreamerGenerator(scrypted_sdk.ScryptedDeviceBase, scrypted_sdk.VideoFrameGenerator, scrypted_sdk.Settings):
    async def generateVideoFrames(self, mediaObject: scrypted_sdk.MediaObject, options: scrypted_sdk.VideoFrameGeneratorOptions = None, filter: Any = None) -> scrypted_sdk.VideoFrame:
        worker = scrypted_sdk.fork()
        forked: CodecFork = await worker.result
        return await forked.generateVideoFramesGstreamer(mediaObject, options, filter, self.storage.getItem('h264Decoder'))
    
    async def getSettings(self) -> List[Setting]:
        return [
            {
                'key': 'h264Decoder',
                'title': 'H264 Decoder',
                'description': 'The Gstreamer pipeline to use to decode H264 video.',
                'value': self.storage.getItem('h264Decoder') or 'Default',
                'choices': [
                    'Default',
                    'decodebin',
                    'vtdec_hw',
                    'nvh264dec',
                    'vaapih264dec',
                ],
                'combobox': True,
            }
        ]
    
    async def putSetting(self, key: str, value: SettingValue) -> None:
        self.storage.setItem(key, value)
        await scrypted_sdk.deviceManager.onDeviceEvent(self.nativeId, scrypted_sdk.ScryptedInterface.Settings.value, None)
    
class PythonCodecs(scrypted_sdk.ScryptedDeviceBase, scrypted_sdk.DeviceProvider):
    def __init__(self, nativeId = None):
        super().__init__(nativeId)

        asyncio.ensure_future(self.initialize())

    async def initialize(self):
        manifest: scrypted_sdk.DeviceManifest = {
            'devices': [],
        }
        if Gst:
            gstDevice: scrypted_sdk.Device = {
                'name': 'Gstreamer',
                'nativeId': 'gstreamer',
                'interfaces': [
                    scrypted_sdk.ScryptedInterface.VideoFrameGenerator.value,
                    scrypted_sdk.ScryptedInterface.Settings.value,
                ],
                'type': scrypted_sdk.ScryptedDeviceType.API.value,
            }
            manifest['devices'].append(gstDevice)

        if av:
            avDevice: scrypted_sdk.Device = {
                'name': 'Libav',
                'nativeId': 'libav',
                'interfaces': [
                    scrypted_sdk.ScryptedInterface.VideoFrameGenerator.value,
                ],
                'type': scrypted_sdk.ScryptedDeviceType.API.value,
            }
            manifest['devices'].append(avDevice)

        manifest['devices'].append({
            'name': 'Image Reader',
            'type': scrypted_sdk.ScryptedDeviceType.Builtin.value,
            'nativeId': 'reader',
            'interfaces': [
                scrypted_sdk.ScryptedInterface.BufferConverter.value,
            ]
        })

        manifest['devices'].append({
            'name': 'Image Writer',
            'type': scrypted_sdk.ScryptedDeviceType.Builtin.value,
            'nativeId': 'writer',
            'interfaces': [
                scrypted_sdk.ScryptedInterface.BufferConverter.value,
            ]
        })

        await scrypted_sdk.deviceManager.onDevicesChanged(manifest)

    def getDevice(self, nativeId: str) -> Any:
        if nativeId == 'gstreamer':
            return GstreamerGenerator('gstreamer')
        if nativeId == 'libav':
            return LibavGenerator('libav')
        
        if vipsimage.pyvips:
            if nativeId == 'reader':
                return vipsimage.ImageReader('reader')
            if nativeId == 'writer':
                return vipsimage.ImageWriter('writer')
        else:
            if nativeId == 'reader':
                return pilimage.ImageReader('reader')
            if nativeId == 'writer':
                return pilimage.ImageWriter('writer')

def create_scrypted_plugin():
    return PythonCodecs()

class CodecFork:
    async def generateVideoFramesGstreamer(self, mediaObject: scrypted_sdk.MediaObject, options: scrypted_sdk.VideoFrameGeneratorOptions = None, filter: Any = None, h264Decoder: str = None) -> scrypted_sdk.VideoFrame:
        start = time.time()
        try:
            async for data in gstreamer.generateVideoFramesGstreamer(mediaObject, options, filter, h264Decoder):
                yield data
        except Exception as e:
            traceback.print_exc()
            raise
        finally:
            print('gstreamer finished after %s' % (time.time() - start))
            import os
            os._exit(os.EX_OK)
            pass

    async def generateVideoFramesLibav(self, mediaObject: scrypted_sdk.MediaObject, options: scrypted_sdk.VideoFrameGeneratorOptions = None, filter: Any = None) -> scrypted_sdk.VideoFrame:
        start = time.time()
        try:
            async for data in libav.generateVideoFramesLibav(mediaObject, options, filter):
                yield data
        except Exception as e:
            traceback.print_exc()
            raise
        finally:
            print('libav finished after %s' % (time.time() - start))
            import sys
            if sys.platform == 'win32':
                sys.exit()
            else:
                import os
                os._exit(os.EX_OK)


async def fork():
   return CodecFork()
