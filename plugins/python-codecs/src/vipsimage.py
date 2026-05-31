import scrypted_sdk
from generator_common import createImageMediaObject

from typing import Any
try:
    import pyvips
    from pyvips import Image
except:
    Image = None
    pyvips = None
from thread import to_thread

class VipsImage(scrypted_sdk.Image):
    def __init__(self, vipsImage: Image) -> None:
        super().__init__()
        self.vipsImage = vipsImage
        self.width = vipsImage.width
        self.height = vipsImage.height

    async def close(self):
        vips = self.vipsImage
        self.vipsImage = None
        if vips:
            vips.invalidate()

    async def toBuffer(self, options: scrypted_sdk.ImageOptions = None) -> bytearray:
        vipsImage: VipsImage = await self.toImageInternal(options)

        if not options or not options.get('format', None):
            def format():
                return memoryview(vipsImage.vipsImage.write_to_memory())
            return await to_thread(format)
        elif options['format'] == 'rgba':
            def format():
                if not vipsImage.vipsImage.bands == 3:
                    rgba = vipsImage.vipsImage.addalpha()
                else:
                    rgba = vipsImage.vipsImage
                return memoryview(rgba.write_to_memory())
            return await to_thread(format)
        elif options['format'] == 'rgb':
            def format():
                if vipsImage.vipsImage.bands == 4:
                    rgb = vipsImage.vipsImage.extract_band(0, n=vipsImage.vipsImage.bands - 1)
                else:
                    rgb = vipsImage.vipsImage
                return memoryview(rgb.write_to_memory())
            return await to_thread(format)
        elif options['format'] == 'gray':
            if vipsImage.vipsImage.bands == 1:
                def format():
                    return memoryview(vipsImage.vipsImage.write_to_memory())
            else:
                def format():
                    if vipsImage.vipsImage.bands == 4:
                        gray = vipsImage.vipsImage.extract_band(0, n=vipsImage.vipsImage.bands - 1)
                    else:
                        gray = vipsImage.vipsImage
                    gray = gray.colourspace("b-w")
                    return memoryview(gray.write_to_memory())
            return await to_thread(format)

        return await to_thread(lambda: vipsImage.vipsImage.write_to_buffer(f'.{options["format"]}[Q=80]'))

    async def toImageInternal(self, options: scrypted_sdk.ImageOptions = None):
       return await to_thread(lambda: toVipsImage(self, options))

    async def toImage(self, options: scrypted_sdk.ImageOptions = None) -> Any:
        if options and options.get('format', None):
            raise Exception('format can only be used with toBuffer')
        newVipsImage = await self.toImageInternal(options)
        return await createImageMediaObject(newVipsImage)

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

class ImageReader(scrypted_sdk.ScryptedDeviceBase, scrypted_sdk.BufferConverter):
    def __init__(self, nativeId: str):
        super().__init__(nativeId)

        self.fromMimeType = 'image/*;converter-weight=2'
        self.toMimeType = scrypted_sdk.ScryptedMimeTypes.Image.value

    async def convert(self, data: Any, fromMimeType: str, toMimeType: str, options: scrypted_sdk.MediaObjectOptions = None) -> Any:
        vips = Image.new_from_buffer(data, '')
        return await createImageMediaObject(VipsImage(vips))

def new_from_memory(data, width: int, height: int, bands: int):
    return Image.new_from_memory(data, width, height, bands, pyvips.BandFormat.UCHAR)

def new_from_buffer(data, width: int, height: int, bands: int):
    return Image.new_from_buffer(data, width, height, bands, pyvips.BandFormat.UCHAR)
