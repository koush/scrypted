from gst_generator import createPipelineIterator, Gst
from gstreamer_postprocess import GstreamerPostProcess, AppleMediaPostProcess, VaapiPostProcess
from util import optional_chain
import scrypted_sdk
from typing import Any
from urllib.parse import urlparse
import vipsimage
import pilimage
import platform
from generator_common import createVideoFrame, createImageMediaObject
from typing import Tuple
import copy

def getBands(caps):
    capsFormat = caps.get_structure(0).get_value('format')

    if capsFormat == 'RGB':
        return 3
    elif capsFormat == 'RGBA':
        return 4
    elif capsFormat == 'NV12' or capsFormat == 'I420':
        return 1

    raise Exception(f'unknown pixel format, please report this bug to @koush on Discord {capsFormat}')

class GstSession:
    def __init__(self, gst) -> None:
        self.gst = gst
        self.reuse = []

class GstImage(scrypted_sdk.Image):
    def __init__(self, gst: GstSession, sample, postProcessPipeline: str):
        super().__init__()
        caps = sample.get_caps()
        self.width = caps.get_structure(0).get_value('width')
        self.height = caps.get_structure(0).get_value('height')
        self.gst = gst
        self.sample = sample
        self.postProcessPipeline = postProcessPipeline

    async def close(self):
        self.sample = None

    async def toImage(self, options: scrypted_sdk.ImageOptions = None):
        copyOptions: scrypted_sdk.ImageOptions = None
        needPostProcess = False
        if not self.postProcessPipeline:
            copyOptions = copy.deepcopy(options)
            if options:
                if options.get('crop') or options.get('resize'):
                    needPostProcess = True
                options['crop'] = None
                options['resize'] = None

        gstsample = await toGstSample(self.gst, self.sample, options, self.postProcessPipeline)
        caps = gstsample.get_caps()
        capsBands = getBands(caps)
        height = caps.get_structure(0).get_value('height')
        width = caps.get_structure(0).get_value('width')

        gst_buffer = gstsample.get_buffer()
        result, info = gst_buffer.map(Gst.MapFlags.READ)
        if not result:
            raise Exception('unable to map gst buffer')

        try:
            if vipsimage.pyvips:
                vips = vipsimage.new_from_memory(bytes(info.data), width, height, capsBands)
                image = vipsimage.VipsImage(vips)
            else:
                pil = pilimage.new_from_memory(bytes(info.data), width, height, capsBands)
                image = pilimage.PILImage(pil)

            if needPostProcess:
                image = await image.toImage(copyOptions)
            return await createImageMediaObject(image)
        finally:
            gst_buffer.unmap(info)
    
    async def toBuffer(self, options: scrypted_sdk.ImageOptions = None):
        format = options and options.get('format')
        if format == 'rgb':
            bands = 3
        elif format == 'rgba':
            bands = 4
        elif format == 'gray':
            bands = 1
        elif format == 'jpg':
            bands = 0
        else:
            raise Exception(f'invalid output format {format}')

        copyOptions: scrypted_sdk.ImageOptions = None
        needPostProcess = False
        if not self.postProcessPipeline:
            copyOptions = copy.deepcopy(options)
            if options:
                if options.get('crop') or options.get('resize'):
                    needPostProcess = True
                options['crop'] = None
                options['resize'] = None

        gstsample = await toGstSample(self.gst, self.sample, options, self.postProcessPipeline)
        caps = gstsample.get_caps()
        height = caps.get_structure(0).get_value('height')
        width = caps.get_structure(0).get_value('width')
        capsFormat = caps.get_structure(0).get_value('format')

        if capsFormat == 'RGB':
            capsBands = 3
        elif capsFormat == 'RGBA':
            capsBands = 4
        elif capsFormat == 'NV12' or capsFormat == 'I420':
            capsBands = 1
        else:
            raise Exception(f'unknown pixel format, please report this bug to @koush on Discord {capsFormat}')

        gst_buffer = gstsample.get_buffer()
        result, info = gst_buffer.map(Gst.MapFlags.READ)
        if not result:
            raise Exception('unable to map gst buffer')

        try:
            # print("~~~~~~~~~SAMPLE", width, height)
            # pil = pilimage.new_from_memory(info.data, width, height, capsBands)
            # pil.convert('RGB').save('/server/volume/test.jpg')

            # format may have been previously specified and known to caller?

            if not needPostProcess:
                if not format:
                    return bytes(info.data)

                if format == 'gray' and capsBands == 1:
                    buffer = bytes(info.data)
                    return buffer[0:width * height]
                
                if bands == capsBands:
                    buffer = bytes(info.data)
                    return buffer

            if vipsimage.pyvips:
                vips = vipsimage.new_from_memory(info.data, width, height, capsBands)
                image = vipsimage.VipsImage(vips)
            else:
                pil = pilimage.new_from_memory(info.data, width, height, capsBands)
                image = pilimage.PILImage(pil)

            try:
                if not self.postProcessPipeline:
                    return await image.toBuffer(copyOptions)
                else:
                    return await image.toBuffer({
                        'format': options and options.get('format'),
                    })
            finally:
                await image.close()
        finally:
            gst_buffer.unmap(info)

async def createResamplerPipeline(sample, gst: GstSession, options: scrypted_sdk.ImageOptions, postProcessPipeline: str):
    if not sample:
        raise Exception('Video Frame has been invalidated')
    
    resize = None
    if options:
        resize = options.get('resize')
        if resize:
            resize = (resize.get('width'), resize.get('height'))

    for check in gst.reuse:
        if check.resize == resize:
            gst.reuse.remove(check)
            return check

    if postProcessPipeline == 'VAAPI':
        pp = VaapiPostProcess()
    elif postProcessPipeline == 'OpenGL (GPU memory)':
        pp = AppleMediaPostProcess()
    elif postProcessPipeline == 'OpenGL (system memory)':
        pp = AppleMediaPostProcess()
    else:
        # trap the pipeline before it gets here. videocrop
        # in the pipeline seems to spam the stdout??
        # use the legacy vips/pil post process.
        pp = GstreamerPostProcess()

    caps = sample.get_caps()

    srcCaps = caps.to_string().replace(' ', '')
    pipeline = f"appsrc name=appsrc emit-signals=True is-live=True caps={srcCaps}"
    await pp.create(gst.gst, pipeline)
    pp.resize = resize

    return pp

async def toGstSample(gst: GstSession, sample, options: scrypted_sdk.ImageOptions, postProcessPipeline: str) -> GstImage:
    if not sample:
        raise Exception('Video Frame has been invalidated')
    if not options:
        return sample
    
    crop = options.get('crop')
    resize = options.get('resize')
    format = options.get('format')

    caps = sample.get_caps()
    sampleWidth = caps.get_structure(0).get_value('width')
    sampleHeight = caps.get_structure(0).get_value('height')
    capsFormat = caps.get_structure(0).get_value('format')

    # normalize format, eliminating it if possible
    if format == 'jpg':
        # get into a format suitable to be be handled by vips/pil
        if capsFormat == 'RGB' or capsFormat == 'RGBA':
            format = None
        else:
            format = 'RGBA'
    elif format == 'rgb':
        if capsFormat == 'RGB':
            format = None
        else:
            format = 'RGB'
    elif format == 'rgba':
        if capsFormat == 'RGBA':
            format = None
        else:
            format = 'RGBA'
    elif format == 'gray':
        # are there others? does the output format depend on GPU?
        # have only ever seen NV12
        if capsFormat == 'NV12' or capsFormat == 'I420':
            format = None
        else:
            format = 'NV12'
    elif format:
        raise Exception(f'invalid output format {format}')

    if not crop and not resize and not format:
        return sample

    pp = await createResamplerPipeline(sample, gst, options, postProcessPipeline)
    try:
        pp.update(caps, (sampleWidth, sampleHeight), options, format)

        appsrc = pp.gst.get_by_name('appsrc')
        srcCaps = caps.to_string().replace(' ', '')
        appsrc.set_property('caps', caps.from_string(srcCaps))

        appsrc.emit("push-sample", sample)

        newSample = await pp.g.__anext__()

        gst.reuse.append(pp)
    except:
        await pp.g.aclose()
        raise

    return newSample

async def createGstMediaObject(image: GstImage):
    ret = await scrypted_sdk.mediaManager.createMediaObject(image, scrypted_sdk.ScryptedMimeTypes.Image.value, {
        'format': None,
        'width': image.width,
        'height': image.height,
        'toBuffer': lambda options = None: image.toBuffer(options),
        'toImage': lambda options = None: image.toImage(options),
    })
    return ret

async def generateVideoFramesGstreamer(mediaObject: scrypted_sdk.MediaObject, options: scrypted_sdk.VideoFrameGeneratorOptions = None, filter: Any = None, h264Decoder: str = None, postProcessPipeline: str = None) -> scrypted_sdk.VideoFrame:
    ffmpegInput: scrypted_sdk.FFmpegInput = await scrypted_sdk.mediaManager.convertMediaObjectToJSON(mediaObject, scrypted_sdk.ScryptedMimeTypes.FFmpegInput.value)
    container = ffmpegInput.get('container', None)
    pipeline = ffmpegInput.get('url')
    videoCodec = optional_chain(ffmpegInput, 'mediaStreamOptions', 'video', 'codec')

    if pipeline.startswith('tcp://'):
        parsed_url = urlparse(pipeline)
        pipeline = 'tcpclientsrc port=%s host=%s' % (
            parsed_url.port, parsed_url.hostname)
        if container == 'mpegts':
            pipeline += ' ! tsdemux'
        elif container == 'sdp':
            pipeline += ' ! sdpdemux'
        else:
            raise Exception('unknown container %s' % container)
    elif pipeline.startswith('rtsp'):
        pipeline = 'rtspsrc buffer-mode=0 location=%s protocols=tcp latency=0' % pipeline
        if videoCodec == 'h264':
            pipeline += ' ! rtph264depay ! h264parse'

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

    fps = options and options.get('fps', None)
    videorate = ''
    if fps:
        videorate = f'! videorate max-rate={fps}'

    if postProcessPipeline == 'VAAPI':
        pipeline += f' ! {decoder} {videorate} ! queue leaky=downstream max-size-buffers=0'
    elif postProcessPipeline == 'OpenGL (GPU memory)':
        pipeline += f' ! {decoder} {videorate} ! queue leaky=downstream max-size-buffers=0 ! glupload'
    elif postProcessPipeline == 'OpenGL (system memory)':
        pipeline += f' ! {decoder} {videorate} ! queue leaky=downstream max-size-buffers=0 ! video/x-raw ! glupload'
    else:
        pipeline += f' ! {decoder} ! video/x-raw {videorate} ! queue leaky=downstream max-size-buffers=0'
        # disable the gstreamer post process because videocrop spams the log
        # postProcessPipeline = 'Default'
        postProcessPipeline = None

    print(pipeline)
    mo: scrypted_sdk.MediaObject = None
    gst, gen = await createPipelineIterator(pipeline)
    gstImage: GstImage = None
    session = GstSession(gst)
    async for gstsample in gen():
        if not mo:
            gstImage = GstImage(session, gstsample, postProcessPipeline)
            mo = await createImageMediaObject(gstImage)
        gstImage.sample = gstsample
        try:
            yield createVideoFrame(mo)
        finally:
            await gstImage.close()
