import scrypted_sdk
from typing import Any
from urllib.parse import urlparse

def optional_chain(root, *keys):
    result = root
    for k in keys:
        if isinstance(result, dict):
            result = result.get(k, None)
        else:
            result = getattr(result, k, None)
        if result is None:
            break
    return result

class PythonCodecs(scrypted_sdk.ScryptedDeviceBase, scrypted_sdk.VideoFrameGenerator):
    def __init__(self, nativeId = None):
        super().__init__(nativeId)

    async def generateVideoFrames(self, mediaObject: scrypted_sdk.MediaObject, options: scrypted_sdk.VideoFrameGeneratorOptions = None, filter: Any = None) -> scrypted_sdk.VideoFrame:
        ffmpegInput: scrypted_sdk.FFmpegInput = await scrypted_sdk.mediaManager.convertMediaObjectToJSON(mediaObject, scrypted_sdk.ScryptedMimeTypes.FFmpegInput.value)
        container = ffmpegInput.get('container', None)
        videosrc = ffmpegInput.get('url')
        videoCodec = optional_chain(ffmpegInput, 'mediaStreamOptions', 'video', 'codec')

        if videosrc.startswith('tcp://'):
            parsed_url = urlparse(videosrc)
            videosrc = 'tcpclientsrc port=%s host=%s' % (
                parsed_url.port, parsed_url.hostname)
            if container == 'mpegts':
                videosrc += ' ! tsdemux'
            elif container == 'sdp':
                videosrc += ' ! sdpdemux'
            else:
                raise Exception('unknown container %s' % container)
        elif videosrc.startswith('rtsp'):
            videosrc = 'rtspsrc buffer-mode=0 location=%s protocols=tcp latency=0 is-live=false' % videosrc
            if videoCodec == 'h264':
                videosrc += ' ! rtph264depay ! h264parse'

        try:
            while True:
                yield 1
        finally:
            print('done!')

def create_scrypted_plugin():
    return PythonCodecs()
