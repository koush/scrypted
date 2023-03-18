import time
from gst_generator import createPipelineIterator
import scrypted_sdk
from typing import Any
import pyvips
from vips import createVipsMediaObject, VipsImage

av = None
try:
    import av
    av.logging.set_level(av.logging.PANIC) 
except:
    pass

async def generateVideoFramesLibav(mediaObject: scrypted_sdk.MediaObject, options: scrypted_sdk.VideoFrameGeneratorOptions = None, filter: Any = None) -> scrypted_sdk.VideoFrame:
    ffmpegInput: scrypted_sdk.FFmpegInput = await scrypted_sdk.mediaManager.convertMediaObjectToJSON(mediaObject, scrypted_sdk.ScryptedMimeTypes.FFmpegInput.value)
    videosrc = ffmpegInput.get('url')
    container = av.open(videosrc)
    # none of this stuff seems to work. might be libav being slow with rtsp.
    # container.no_buffer = True
    # container.gen_pts = False
    # container.options['-analyzeduration'] = '0'
    # container.options['-probesize'] = '500000'
    stream = container.streams.video[0]
    # stream.codec_context.thread_count = 1
    # stream.codec_context.low_delay = True
    # stream.codec_context.options['-analyzeduration'] = '0'
    # stream.codec_context.options['-probesize'] = '500000'

    start = 0
    try:
        for idx, frame in enumerate(container.decode(stream)):
            now = time.time()
            if not start:
                start = now
            elapsed = now - start
            if (frame.time or 0) < elapsed - 0.500:
                # print('too slow, skipping frame')
                continue
            # print(frame)
            vips = pyvips.Image.new_from_array(frame.to_ndarray(format='rgb24'))
            vipsImage = VipsImage(vips)
            try:
                mo = await createVipsMediaObject(VipsImage(vips))
                yield mo
            finally:
                vipsImage.vipsImage.invalidate()
                vipsImage.vipsImage = None

    finally:
        container.close()
