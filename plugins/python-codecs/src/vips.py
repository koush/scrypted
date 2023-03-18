import time
from gst_generator import createPipelineIterator
import asyncio
from util import optional_chain
import scrypted_sdk
from typing import Any
from urllib.parse import urlparse
import pyvips
import concurrent.futures

# vips is already multithreaded, but needs to be kicked off the python asyncio thread.
vipsExecutor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="vips")

async def to_thread(f):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(vipsExecutor, f)

class VipsImage(scrypted_sdk.VideoFrame):
    def __init__(self, vipsImage: pyvips.Image) -> None:
        super().__init__()
        self.vipsImage = vipsImage
        self.width = vipsImage.width
        self.height = vipsImage.height

    async def toBuffer(self, options: scrypted_sdk.ImageOptions = None) -> bytearray:
        vipsImage: VipsImage = await self.toVipsImage(options)

        if not options or not options.get('format', None):
            def format():
                return memoryview(vipsImage.vipsImage.write_to_memory())
            return await to_thread(format)
        elif options['format'] == 'rgb':
            def format():
                if vipsImage.vipsImage.hasalpha():
                    rgb = vipsImage.vipsImage.extract_band(0, n=vipsImage.vipsImage.bands - 1)
                else:
                    rgb = vipsImage.vipsImage
                mem = memoryview(rgb.write_to_memory())
                return mem
            return await to_thread(format)

        return await to_thread(lambda: vipsImage.vipsImage.write_to_buffer('.' + options['format']))

    async def toVipsImage(self, options: scrypted_sdk.ImageOptions = None):
       return await to_thread(lambda: toVipsImage(self, options))

    async def toImage(self, options: scrypted_sdk.ImageOptions = None) -> Any:
        if options and options.get('format', None):
            raise Exception('format can only be used with toBuffer')
        newVipsImage = await self.toVipsImage(options)
        return await createVipsMediaObject(newVipsImage)

def toVipsImage(vipsImageWrapper: VipsImage, options: scrypted_sdk.ImageOptions = None) -> VipsImage:
    vipsImage = vipsImageWrapper.vipsImage
    if not vipsImage:
        raise Exception('Video Frame has been invalidated')
    options = options or {}
    crop = options.get('crop')
    if crop:
        vipsImage = vipsImage.crop(int(crop['left']), int(crop['top']), int(crop['width']), int(crop['height']))
        
    resize = options.get('resize')
    if resize:
        xscale = None
        if resize.get('width'):
            xscale = resize['width'] / vipsImage.width 
            scale = xscale
        yscale = None
        if resize.get('height'):
            yscale = resize['height'] / vipsImage.height
            scale = yscale

        if xscale and yscale:
            scale = min(yscale, xscale)

        xscale = xscale or yscale
        yscale = yscale or xscale
        vipsImage = vipsImage.resize(xscale, vscale=yscale, kernel='linear')

    return VipsImage(vipsImage)

async def createVipsMediaObject(image: VipsImage):
    ret = await scrypted_sdk.mediaManager.createMediaObject(image, scrypted_sdk.ScryptedMimeTypes.Image.value, {
        'width': image.width,
        'height': image.height,
        'toBuffer': lambda options = None: image.toBuffer(options),
        'toImage': lambda options = None: image.toImage(options),
    })
    return ret

class ImageReader(scrypted_sdk.ScryptedDeviceBase, scrypted_sdk.BufferConverter):
    def __init__(self, nativeId: str):
        super().__init__(nativeId)

        self.fromMimeType = 'image/*'
        self.toMimeType = scrypted_sdk.ScryptedMimeTypes.Image.value

    async def convert(self, data: Any, fromMimeType: str, toMimeType: str, options: scrypted_sdk.MediaObjectOptions = None) -> Any:
        vips = pyvips.Image.new_from_buffer(data, '')
        return await createVipsMediaObject(VipsImage(vips))

class ImageWriter(scrypted_sdk.ScryptedDeviceBase, scrypted_sdk.BufferConverter):
    def __init__(self, nativeId: str):
        super().__init__(nativeId)

        self.fromMimeType = scrypted_sdk.ScryptedMimeTypes.Image.value
        self.toMimeType = 'image/*'

    async def convert(self, data: scrypted_sdk.VideoFrame, fromMimeType: str, toMimeType: str, options: scrypted_sdk.MediaObjectOptions = None) -> Any:
        return await data.toBuffer({
            format: 'jpg',
        })
