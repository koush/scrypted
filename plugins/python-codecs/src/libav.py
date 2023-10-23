import time
import scrypted_sdk
from typing import Any
import vipsimage
import pilimage
from generator_common import createVideoFrame, createImageMediaObject
import threading
import asyncio

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
    container.options['analyzeduration'] = '0'
    container.options['probesize'] = '500000'
    stream = container.streams.video[0]
    # stream.codec_context.thread_count = 1
    # stream.codec_context.low_delay = True
    # stream.codec_context.options['-analyzeduration'] = '0'
    # stream.codec_context.options['-probesize'] = '500000'

    gray = options and options.get('format') == 'gray'

    sampleQueue = asyncio.Queue(1)
    loop = asyncio.get_event_loop()

    def threadMain():
        try:
            for idx, frame in enumerate(container.decode(stream)):
                try:
                    # non blocking put may fail if queue is not empty
                    sampleQueue.put_nowait(frame)
                except:
                    pass
        except:
            asyncio.run_coroutine_threadsafe(sampleQueue.put(None), loop = loop)

    thread = threading.Thread(target=threadMain)
    thread.start()

    print(time.time())
    try:
        vipsImage: vipsimage.VipsImage = None
        pilImage: pilimage.PILImage = None
        mo: scrypted_sdk.MediaObject = None

        firstFrame = False
        while True:
            frame = await sampleQueue.get()
            if not frame:
                break

            if not firstFrame:
                print('first frame')
                print(time.time())
                firstFrame = True

            if vipsimage.pyvips:
                if gray and frame.format.name.startswith('yuv') and frame.planes and len(frame.planes):
                    vips = vipsimage.new_from_memory(memoryview(frame.planes[0]), frame.width, frame.height, 1)
                elif gray:
                    vips = vipsimage.pyvips.Image.new_from_array(frame.to_ndarray(format='gray'))
                else:
                    vips = vipsimage.pyvips.Image.new_from_array(frame.to_ndarray(format='rgb24'))

                if not mo:
                    vipsImage = vipsimage.VipsImage(vips)
                    mo = await createImageMediaObject(vipsImage)

                vipsImage.vipsImage = vips
                try:
                    yield createVideoFrame(mo)
                finally:
                    await vipsImage.close()
            else:
                if gray and frame.format.name.startswith('yuv') and frame.planes and len(frame.planes):
                    pil = pilimage.new_from_memory(memoryview(frame.planes[0]), frame.width, frame.height, 1)
                elif gray:
                    rgb = frame.to_image()
                    try:
                        pil = rgb.convert('L')
                    finally:
                        rgb.close()
                else:
                    pil = frame.to_image()

                if not mo:
                    pilImage = pilimage.PILImage(pil)
                    mo = await createImageMediaObject(pilImage)

                pilImage.pilImage = pil
                try:
                    yield createVideoFrame(mo)
                finally:
                    await pilImage.close()
    finally:
        container.close()
