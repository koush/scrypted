import asyncio
import platform
from asyncio import Future
from typing import Any
from urllib.parse import urlparse

import scrypted_sdk

import pilimage
import vipsimage
from generator_common import createImageMediaObject, createVideoFrame
from gst_generator import Gst, createPipelineIterator
from gstreamer_postprocess import (GstreamerFormatPostProcess,
                                   GstreamerPostProcess, OpenGLPostProcess,
                                   VaapiPostProcess, getBands)
from util import optional_chain


class GstSession:
    def __init__(self, gst) -> None:
        self.gst = gst
        self.reuse = []


class GstImage(scrypted_sdk.Image):
    def __init__(self, gst: GstSession, sample, postProcessPipeline: str):
        super().__init__()
        caps = sample.get_caps()
        self.width = caps.get_structure(0).get_value("width")
        self.height = caps.get_structure(0).get_value("height")
        self.gst = gst
        self.sample = sample
        self.postProcessPipeline = postProcessPipeline
        self.cached: Future[scrypted_sdk.Image] = None

    async def close(self):
        self.sample = None

    async def toImage(self, options: scrypted_sdk.ImageOptions = None):
        options = options or {}
        # this is preferable currently because all detectors use rgb inputs
        # as opposed to yuv or rgba.
        # consider respecting the incoming format if provided?
        options["format"] = "rgb"

        gstsample = await toGstSample(
            self.gst, self.sample, options, self.postProcessPipeline
        )
        caps = gstsample.get_caps()
        height = caps.get_structure(0).get_value("height")
        width = caps.get_structure(0).get_value("width")
        capsBands = getBands(caps)

        gst_buffer = gstsample.get_buffer()
        result, info = gst_buffer.map(Gst.MapFlags.READ)
        if not result:
            raise Exception("unable to map gst buffer")

        try:
            if vipsimage.pyvips:
                vips = vipsimage.new_from_memory(
                    bytes(info.data), width, height, capsBands
                )
                image = vipsimage.VipsImage(vips)
            else:
                pil = pilimage.new_from_memory(
                    bytes(info.data), width, height, capsBands
                )
                image = pilimage.PILImage(pil)

            return await createImageMediaObject(image)
        finally:
            gst_buffer.unmap(info)

    async def toBuffer(self, options: scrypted_sdk.ImageOptions = None):
        format = options and options.get("format")
        if format == "rgb":
            bands = 3
        elif format == "rgba":
            bands = 4
        elif format == "gray":
            bands = 1
        elif format == "jpg":
            bands = 0
        else:
            raise Exception(f"invalid output format {format}")

        gstsample = await toGstSample(
            self.gst, self.sample, options, self.postProcessPipeline
        )
        caps = gstsample.get_caps()
        height = caps.get_structure(0).get_value("height")
        width = caps.get_structure(0).get_value("width")
        # toGstSample may return the I420/NV12 image if there
        # is no transformation necessary. ie, a low res stream being used
        # for motion detection.
        if format == 'gray' and self.sample == gstsample:
            capsBands = 1
        else:
            capsBands = getBands(caps)

        gst_buffer = gstsample.get_buffer()
        result, info = gst_buffer.map(Gst.MapFlags.READ)
        if not result:
            raise Exception("unable to map gst buffer")

        try:
            stridePadding = (width * capsBands) % 4
            if stridePadding:
                stridePadding = 4 - stridePadding

            if stridePadding:
                if capsBands != 1:
                    raise Exception(
                        f"found stride in conversion. this should not be possible. {caps.to_string()}"
                    )
                width += stridePadding
            else:
                if format == "gray" and capsBands == 1:
                    buffer = bytes(info.data)
                    return buffer[0 : width * height]

                if bands == capsBands:
                    buffer = bytes(info.data)
                    return buffer

            if vipsimage.pyvips:
                vips = vipsimage.new_from_memory(info.data, width, height, capsBands)
                image = vipsimage.VipsImage(vips)
            else:
                pil = pilimage.new_from_memory(info.data, width, height, capsBands)
                image = pilimage.PILImage(pil)

            # if bands == 1:
            #     pil = pilimage.new_from_memory(info.data, width, height, capsBands)
            #     pil.convert('RGB').save('/server/volume/test.jpg')

            crop = None
            if stridePadding:
                crop = {
                    "left": 0,
                    "top": 0,
                    "width": width - stridePadding,
                    "height": height,
                }
            
            reformat = None
            if bands and bands != capsBands:
                reformat = format

            colored = None
            if reformat or crop:
                colored = image
                image = await image.toImageInternal(
                    {
                        "crop": crop,
                        "format": reformat,
                    }
                )
            try:
                return await image.toBuffer(
                    {
                        "format": format,
                    }
                )
            finally:
                await image.close()
                if colored:
                    await colored.close()
        finally:
            gst_buffer.unmap(info)


async def createResamplerPipeline(
    sample,
    gst: GstSession,
    options: scrypted_sdk.ImageOptions,
    postProcessPipeline: str,
):
    if not sample:
        raise Exception("Video Frame has been invalidated")

    resize = None
    if options:
        resize = options.get("resize")
        if resize:
            resize = (resize.get("width"), resize.get("height"))

    for check in gst.reuse:
        if check.resize == resize:
            gst.reuse.remove(check)
            return check

    if postProcessPipeline == "VAAPI":
        pp = VaapiPostProcess()
    elif postProcessPipeline == "OpenGL (GPU memory)":
        pp = OpenGLPostProcess()
    elif postProcessPipeline == "OpenGL (system memory)":
        pp = OpenGLPostProcess()
    elif postProcessPipeline == None:
        pp = GstreamerFormatPostProcess()
    else:
        # trap the pipeline before it gets here. videocrop
        # in the pipeline seems to spam the stdout??
        # use the legacy vips/pil post process.
        pp = GstreamerPostProcess()

    caps = sample.get_caps()

    srcCaps = caps.to_string().replace(" ", "")
    pipeline = f"appsrc name=appsrc format=time emit-signals=True is-live=True caps={srcCaps}"
    await pp.create(gst.gst, pipeline)
    pp.resize = resize

    return pp


async def toGstSample(
    gst: GstSession,
    sample,
    options: scrypted_sdk.ImageOptions,
    postProcessPipeline: str,
) -> GstImage:
    if not sample:
        raise Exception("Video Frame has been invalidated")
    if not options:
        return sample

    crop = options.get("crop")
    resize = options.get("resize")
    format = options.get("format")

    caps = sample.get_caps()
    sampleWidth = caps.get_structure(0).get_value("width")
    sampleHeight = caps.get_structure(0).get_value("height")
    capsFormat = caps.get_structure(0).get_value("format")

    # normalize format, eliminating it if possible
    if format == "jpg":
        # get into a format suitable to be be handled by vips/pil
        if capsFormat == "RGB" or capsFormat == "RGBA":
            sinkFormat = None
        else:
            sinkFormat = "RGBA"
    elif format == "rgb":
        if capsFormat == "RGB":
            sinkFormat = None
        else:
            sinkFormat = "RGB"
    elif format == "rgba":
        if capsFormat == "RGBA":
            sinkFormat = None
        else:
            sinkFormat = "RGBA"
    elif format == "gray":
        # are there others? does the output format depend on GPU?
        # have only ever seen NV12
        if capsFormat == "NV12" or capsFormat == "I420" or capsFormat == "GRAY8":
            sinkFormat = None
        else:
            sinkFormat = "GRAY8"
    elif format:
        raise Exception(f"invalid output format {format}")

    if not crop and not resize and not sinkFormat:
        return sample

    pp = await createResamplerPipeline(sample, gst, options, postProcessPipeline)
    try:
        pp.update(caps, (sampleWidth, sampleHeight), options)

        appsrc = pp.gst.get_by_name("appsrc")
        srcCaps = caps.to_string().replace(" ", "")
        appsrc.set_property("caps", caps.from_string(srcCaps))

        appsrc.emit("push-sample", sample)

        newSample = await pp.g.__anext__()

        gst.reuse.append(pp)
    except:
        await pp.g.aclose()
        raise

    return newSample


async def createGstMediaObject(image: GstImage):
    ret = await scrypted_sdk.mediaManager.createMediaObject(
        image,
        scrypted_sdk.ScryptedMimeTypes.Image.value,
        {
            "format": None,
            "width": image.width,
            "height": image.height,
            "toBuffer": lambda options=None: image.toBuffer(options),
            "toImage": lambda options=None: image.toImage(options),
        },
    )
    return ret


async def generateVideoFramesGstreamer(
    mediaObject: scrypted_sdk.MediaObject,
    options: scrypted_sdk.VideoFrameGeneratorOptions = None,
    filter: Any = None,
    h264Decoder: str = None,
    postProcessPipeline: str = None,
) -> scrypted_sdk.VideoFrame:
    ffmpegInput: scrypted_sdk.FFmpegInput = (
        await scrypted_sdk.mediaManager.convertMediaObjectToJSON(
            mediaObject, scrypted_sdk.ScryptedMimeTypes.FFmpegInput.value
        )
    )
    container = ffmpegInput.get("container", None)
    pipeline = ffmpegInput.get("url")
    videoCodec = optional_chain(ffmpegInput, "mediaStreamOptions", "video", "codec")

    if pipeline.startswith("tcp://"):
        parsed_url = urlparse(pipeline)
        pipeline = "tcpclientsrc port=%s host=%s" % (
            parsed_url.port,
            parsed_url.hostname,
        )
        if container == "mpegts":
            pipeline += " ! tsdemux"
        elif container == "sdp":
            pipeline += " ! sdpdemux"
        else:
            raise Exception("unknown container %s" % container)
    elif pipeline.startswith("rtsp"):
        pipeline = (
            "rtspsrc buffer-mode=0 location=%s protocols=tcp latency=0" % pipeline
        )
        if videoCodec == "h264":
            pipeline += " ! rtph264depay ! h264parse"

    decoder = None

    def setDecoderClearDefault(value: str):
        nonlocal decoder
        decoder = value
        if decoder == "Default":
            decoder = None

    setDecoderClearDefault(None)

    if videoCodec == "h264":
        setDecoderClearDefault(h264Decoder)

        if not decoder:
            # hw acceleration is "safe" to use on mac, but not
            # on other hosts where it may crash.
            # defaults must be safe.
            if platform.system() == "Darwin":
                decoder = "vtdec_hw"
            else:
                decoder = "avdec_h264 output-corrupt=false"
    else:
        # decodebin may pick a hardware accelerated decoder, which isn't ideal
        # so use a known software decoder for h264 and decodebin for anything else.
        decoder = "decodebin"

    fps = options and options.get("fps", None)
    videorate = ""
    if fps:
        videorate = f"! videorate max-rate={fps}"

    queue = "! queue leaky=downstream max-size-buffers=0"
    if options and options.get('firstFrameOnly'):
        queue = ""

    if postProcessPipeline == "VAAPI":
        pipeline += (
            f" ! {decoder} {videorate} {queue}"
        )
    elif postProcessPipeline == "OpenGL (GPU memory)":
        pipeline += f" ! {decoder} {videorate} {queue} ! glupload"
    elif postProcessPipeline == "OpenGL (system memory)":
        pipeline += f" ! {decoder} {videorate} {queue} ! video/x-raw ! glupload"
    else:
        pipeline += f" ! {decoder} ! video/x-raw {videorate} {queue}"
        # disable the gstreamer post process because videocrop spams the log
        postProcessPipeline = "Default"
        # postProcessPipeline = None

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
