from gst_generator import createPipelineIterator
from util import optional_chain
import scrypted_sdk
from typing import Any
from urllib.parse import urlparse
import pyvips
from vips import createVipsMediaObject, VipsImage
import platform

Gst = None
try:
    import gi
    gi.require_version('Gst', '1.0')
    gi.require_version('GstBase', '1.0')

    from gi.repository import Gst
except:
    pass

async def generateVideoFramesGstreamer(mediaObject: scrypted_sdk.MediaObject, options: scrypted_sdk.VideoFrameGeneratorOptions = None, filter: Any = None, h264Decoder: str = None) -> scrypted_sdk.VideoFrame:
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

    videocaps = 'video/x-raw'
    # if options and options.get('resize'):
    #     videocaps = 'videoscale ! video/x-raw,width={width},height={height}'.format(width=options['resize']['width'], height=options['resize']['height'])

    format = options and options.get('format')
    # I420 is a cheap way to get gray out of an h264 stream without color conversion.
    if format == 'gray':
        format = 'I420'
        bands = 1
    else:
        format = 'RGB'
        bands = 3
    
    videocaps += ',format={format}'.format(format=format)

    decoder = None
    def setDecoderClearDefault(value: str):
        nonlocal decoder
        decoder = value
        if decoder == 'Default':
            decoder = None

    setDecoderClearDefault(None)

    if videoCodec == 'h264':
        setDecoderClearDefault(h264Decoder)

        if not decoder:
            # hw acceleration is "safe" to use on mac, but not
            # on other hosts where it may crash.
            # defaults must be safe.
            if platform.system() == 'Darwin':
                decoder = 'vtdec_hw'
            else:
                decoder = 'avdec_h264'
    else:
        # decodebin may pick a hardware accelerated decoder, which isn't ideal
        # so use a known software decoder for h264 and decodebin for anything else.
        decoder = 'decodebin'

    videosrc += ' ! {decoder} ! queue leaky=downstream max-size-buffers=0 ! videoconvert ! {videocaps}'.format(decoder=decoder, videocaps=videocaps)

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
            vips = pyvips.Image.new_from_memory(info.data, width, height, bands, pyvips.BandFormat.UCHAR)
            vipsImage = VipsImage(vips)
            try:
                mo = await createVipsMediaObject(VipsImage(vips))
                yield mo
            finally:
                vipsImage.vipsImage.invalidate()
                vipsImage.vipsImage = None
        finally:
            gst_buffer.unmap(info)
