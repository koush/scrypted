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
