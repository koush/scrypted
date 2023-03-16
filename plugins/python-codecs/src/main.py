import time
from gstreamer import createPipelineIterator
import asyncio
from util import optional_chain
import scrypted_sdk
from typing import Any
from urllib.parse import urlparse
import pyvips
import concurrent.futures

Gst = None
try:
    import gi
    gi.require_version('Gst', '1.0')
    gi.require_version('GstBase', '1.0')

    from gi.repository import Gst
except:
    pass

av = None
try:
    import av
    av.logging.set_level(av.logging.PANIC) 
except:
    pass

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
                    rgb = vipsImage.vipsImage.extract_band(0, vipsImage.vipsImage.bands - 1)
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

class LibavGenerator(scrypted_sdk.ScryptedDeviceBase, scrypted_sdk.VideoFrameGenerator):
    async def generateVideoFrames(self, mediaObject: scrypted_sdk.MediaObject, options: scrypted_sdk.VideoFrameGeneratorOptions = None, filter: Any = None) -> scrypted_sdk.VideoFrame:
        worker = scrypted_sdk.fork()
        forked: CodecFork = await worker.result
        return await forked.generateVideoFramesLibav(mediaObject, options, filter)

class GstreamerGenerator(scrypted_sdk.ScryptedDeviceBase, scrypted_sdk.VideoFrameGenerator):
    async def generateVideoFrames(self, mediaObject: scrypted_sdk.MediaObject, options: scrypted_sdk.VideoFrameGeneratorOptions = None, filter: Any = None) -> scrypted_sdk.VideoFrame:
        worker = scrypted_sdk.fork()
        forked: CodecFork = await worker.result
        return await forked.generateVideoFramesGstreamer(mediaObject, options, filter)
    
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

        await scrypted_sdk.deviceManager.onDevicesChanged(manifest)

    def getDevice(self, nativeId: str) -> Any:
        if nativeId == 'gstreamer':
            return GstreamerGenerator('gstreamer')
        if nativeId == 'libav':
            return LibavGenerator('libav')

def create_scrypted_plugin():
    return PythonCodecs()

async def generateVideoFramesLibav(mediaObject: scrypted_sdk.MediaObject, options: scrypted_sdk.VideoFrameGeneratorOptions = None, filter: Any = None) -> scrypted_sdk.VideoFrame:
    ffmpegInput: scrypted_sdk.FFmpegInput = await scrypted_sdk.mediaManager.convertMediaObjectToJSON(mediaObject, scrypted_sdk.ScryptedMimeTypes.FFmpegInput.value)
    videosrc = ffmpegInput.get('url')
    container = av.open(videosrc, options = options)
    # none of this stuff seems to work. might be libav being slow with rtsp.
    # container.no_buffer = True
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


async def generateVideoFramesGstreamer(mediaObject: scrypted_sdk.MediaObject, options: scrypted_sdk.VideoFrameGeneratorOptions = None, filter: Any = None) -> scrypted_sdk.VideoFrame:
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

    videosrc += ' ! decodebin ! queue leaky=downstream max-size-buffers=0 ! videoconvert ! video/x-raw,format=RGB'

    gst, gen = createPipelineIterator(videosrc)
    async for gstsample in gen():
        caps = gstsample.get_caps()
        height = caps.get_structure(0).get_value('height')
        width = caps.get_structure(0).get_value('width')
        gst_buffer = gstsample.get_buffer()
        result, info = gst_buffer.map(Gst.MapFlags.READ)
        if not result:
            continue

        try:
            # pyvips.Image.new_from_memory(info.data, width, height, 3, pyvips.BandFormat.UCHAR)
            vips = pyvips.Image.new_from_memory(info.data, width, height, 3, pyvips.BandFormat.UCHAR)
            vipsImage = VipsImage(vips)
            try:
                mo = await createVipsMediaObject(VipsImage(vips))
                yield mo
            finally:
                vipsImage.vipsImage.invalidate()
                vipsImage.vipsImage = None
        finally:
            gst_buffer.unmap(info)

class CodecFork:
    async def generateVideoFramesGstreamer(self, mediaObject: scrypted_sdk.MediaObject, options: scrypted_sdk.VideoFrameGeneratorOptions = None, filter: Any = None) -> scrypted_sdk.VideoFrame:
        try:
            async for data in generateVideoFramesGstreamer(mediaObject, options, filter):
                yield data
        finally:
            import os
            os._exit(os.EX_OK)
            pass

    async def generateVideoFramesLibav(self, mediaObject: scrypted_sdk.MediaObject, options: scrypted_sdk.VideoFrameGeneratorOptions = None, filter: Any = None) -> scrypted_sdk.VideoFrame:
        try:
            async for data in generateVideoFramesLibav(mediaObject, options, filter):
                yield data
        finally:
            import os
            os._exit(os.EX_OK)
            pass


async def fork():
   return CodecFork()
