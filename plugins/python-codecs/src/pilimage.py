import scrypted_sdk
from typing import Any
from thread import to_thread
import io

try:
    from PIL import Image
except:
    # Image = None
    pass

class PILImage(scrypted_sdk.VideoFrame):
    def __init__(self, pilImage: Image.Image) -> None:
        super().__init__()
        self.pilImage = pilImage
        self.width = pilImage.width
        self.height = pilImage.height

    async def toBuffer(self, options: scrypted_sdk.ImageOptions = None) -> bytearray:
        pilImage: PILImage = await self.toPILImage(options)

        if not options or not options.get('format', None):
            def format():
                return pilImage.pilImage.tobytes()
            return await to_thread(format)
        elif options['format'] == 'rgb':
            def format():
                rgbx = pilImage.pilImage
                if rgbx.mode != 'RGBA':
                    return rgbx.tobytes()
                rgb = rgbx.convert('RGB')
                try:
                    return rgb.tobytes()
                finally:
                    rgb.close()
            return await to_thread(format)
        # TODO: gray...

        def save():
            bytesArray = io.BytesIO()
            pilImage.pilImage.save(bytesArray, format='JPEG')
            # pilImage.pilImage.save(bytesArray, format=options['format'])
            return bytesArray.getvalue()

        return await to_thread(lambda: save())

    async def toPILImage(self, options: scrypted_sdk.ImageOptions = None):
       return await to_thread(lambda: toPILImage(self, options))

    async def toImage(self, options: scrypted_sdk.ImageOptions = None) -> Any:
        if options and options.get('format', None):
            raise Exception('format can only be used with toBuffer')
        newPILImage = await self.toPILImage(options)
        return await createPILMediaObject(newPILImage)

def toPILImage(pilImageWrapper: PILImage, options: scrypted_sdk.ImageOptions = None) -> PILImage:
    pilImage = pilImageWrapper.pilImage
    if not pilImage:
        raise Exception('Video Frame has been invalidated')
    options = options or {}
    crop = options.get('crop')
    if crop:
        pilImage = pilImage.crop((int(crop['left']), int(crop['top']), int(crop['left']) + int(crop['width']), int(crop['top']) + int(crop['height'])))
        
    resize = options.get('resize')
    if resize:
        width = resize.get('width')
        if width:
            xscale = resize['width'] / pilImage.width 
            height = pilImage.height * xscale

        height = resize.get('height')
        if height:
            yscale = resize['height'] / pilImage.height
            if not width:
                width = pilImage.width * yscale

        pilImage = pilImage.resize((width, height), resample=Image.BILINEAR)

    return PILImage(pilImage)

async def createPILMediaObject(image: PILImage):
    ret = await scrypted_sdk.mediaManager.createMediaObject(image, scrypted_sdk.ScryptedMimeTypes.Image.value, {
        'format': None,
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
        pil = Image.open(io.BytesIO(data))
        pil.load()
        return await createPILMediaObject(PILImage(pil))

class ImageWriter(scrypted_sdk.ScryptedDeviceBase, scrypted_sdk.BufferConverter):
    def __init__(self, nativeId: str):
        super().__init__(nativeId)

        self.fromMimeType = scrypted_sdk.ScryptedMimeTypes.Image.value
        self.toMimeType = 'image/*'

    async def convert(self, data: scrypted_sdk.VideoFrame, fromMimeType: str, toMimeType: str, options: scrypted_sdk.MediaObjectOptions = None) -> Any:
        return await data.toBuffer({
            format: 'jpg',
        })

def new_from_memory(data, width: int, height: int, bands: int):
    data = bytes(data)
    if bands == 4:
        return Image.frombuffer('RGBA', (width, height), data)
    if bands == 3:
        return Image.frombuffer('RGB', (width, height), data)
    if bands == 1:
        return Image.frombuffer('L', (width, height), data)
    raise Exception('cant handle bands')
