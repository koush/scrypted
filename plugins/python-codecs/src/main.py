from gstreamer import createPipelineIterator
import asyncio
from util import optional_chain
import scrypted_sdk
from typing import Any
from urllib.parse import urlparse
import pyvips
import threading
import traceback

try:
    import gi
    gi.require_version('Gst', '1.0')
    gi.require_version('GstBase', '1.0')

    from gi.repository import Gst
except:
    pass

async def to_thread(f):
    return await asyncio.to_thread(f)

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
       return await to_thread(lambda: toVipsImage(self.vipsImage, options))

    async def toImage(self, options: scrypted_sdk.ImageOptions = None) -> Any:
        if options and options['format']:
            raise Exception('format can only be used with toBuffer')
        newVipsImage = await self.toVipsImage(options)
        return await createVipsMediaObject(newVipsImage)

def toVipsImage(vipsImage: pyvips.Image, options: scrypted_sdk.ImageOptions = None) -> VipsImage:
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

        videosrc += ' ! decodebin ! videoconvert ! video/x-raw,format=RGB'

        try:
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
                    vipsImage = await createVipsMediaObject(VipsImage(vips))
                    yield vipsImage
                finally:
                    gst_buffer.unmap(info)
        except:
            traceback.print_exc()
        finally:
            print('done!')

def create_scrypted_plugin():
    return PythonCodecs()
