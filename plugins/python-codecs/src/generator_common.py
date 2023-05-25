import scrypted_sdk
import time

async def flush():
    pass

def createVideoFrame(image) -> scrypted_sdk.VideoFrame:
    return {
        '__json_copy_serialize_children': True,
        'image': image,
        'queued': 0,
        'timestamp': time.time() * 1000,
        'flush': flush,
    }

async def createImageMediaObject(image: scrypted_sdk.Image):
    ret = await scrypted_sdk.mediaManager.createMediaObject(image, scrypted_sdk.ScryptedMimeTypes.Image.value, {
        'format': None,
        'width': image.width,
        'height': image.height,
        'toBuffer': lambda options = None: image.toBuffer(options),
        'toImage': lambda options = None: image.toImage(options),
    })
    return ret
