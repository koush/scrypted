import scrypted_sdk
from typing import Tuple
from gst_generator import createPipelineIterator

def getCapsFormat(caps):
    return caps.get_structure(0).get_value('format')

def getBands(caps):
    capsFormat = getCapsFormat(caps)

    if capsFormat == 'RGB':
        return 3
    elif capsFormat == 'RGBA':
        return 4
    elif capsFormat == 'GRAY8':
        return 1

    raise Exception(f'unknown pixel format, please report this bug to @koush on Discord {capsFormat}')

def toCapsFormat(options: scrypted_sdk.ImageOptions):
    format = options.get('format')

    if format == 'jpg':
        return 'RGB'
    elif format == 'rgb':
        return 'RGB'
    elif format == 'rgba':
        return 'RGBA'
    elif format == 'gray':
        return 'GRAY8'
    elif format:
        raise Exception(f'invalid output format {format}')
    else:
        return None

class GstreamerPostProcess():
    def __init__(self) -> None:
        self.postprocess = ' ! videocrop name=videocrop ! videoconvert ! videoscale add-borders=false ! capsfilter name=scaleCapsFilter'
        self.resize = None

    async def create(self, gst, pipeline: str):
        gst, gen = await createPipelineIterator(pipeline + self.postprocess, gst)
        g = gen()
        self.gst = gst
        self.g = g
        self.videocrop = self.gst.get_by_name('videocrop')
        self.scaleCapsFilter = self.gst.get_by_name('scaleCapsFilter')

    def update(self, caps, sampleSize: Tuple[int, int], options: scrypted_sdk.ImageOptions):
        sampleWidth, sampleHeight = sampleSize

        crop = options.get('crop')
        resize = options.get('resize')

        if crop:
            left = int(crop['left'])
            top = int(crop['top'])
            width = int(crop['width'])
            height = int(crop['height'])
            # right and bottom crop values are pixel distance from the corresponding edge,
            # not a bounding box
            right = sampleWidth - (left + width)
            bottom = sampleHeight - (top + height)
        else:
            left = 0
            top = 0
            right = 0
            bottom = 0

        videocrop = self.videocrop
        videocrop.set_property('left', left)
        videocrop.set_property('top', top)
        videocrop.set_property('right', right)
        videocrop.set_property('bottom', bottom)

        scaleCaps = "video/x-raw,pixel-aspect-ratio=(fraction)1/1"
        if resize:
            width = resize.get('width')
            if width:
                xscale = resize['width'] / sampleWidth 
                height = sampleHeight * xscale

            height = resize.get('height')
            if height:
                yscale = resize['height'] / sampleHeight
                if not width:
                    width = sampleWidth * yscale

            width = int(width)
            height = int(height)

            # pipeline += " ! videoscale"
            scaleCaps += f",width={width},height={height}"

        # gstreamer aligns stride to a 4 byte boundary.
        # this makes it painful to get data out with RGB, NV12, or I420.
        format = toCapsFormat(options)
        if format != 'RGBA':
            if not format:
                format = 'RGBA'
            elif format == 'RGB':
                format = 'RGBA'
            elif format == 'GRAY8':
                pass
            else:
                raise Exception('unexpected target format returned from toCapsFormat')

        scaleCaps += f",format={format}"

        self.scaleCapsFilter.set_property('caps', caps.from_string(scaleCaps))

class VaapiPostProcess():
    def __init__(self) -> None:
        self.postprocess = ' ! vaapipostproc name=vaapipostproc ! capsfilter name=capsFilter'
        self.resize = None

    async def create(self, gst, pipeline: str):
        gst, gen = await createPipelineIterator(pipeline + self.postprocess, gst)
        g = gen()
        self.gst = gst
        self.g = g
        self.vaapipostproc = self.gst.get_by_name('vaapipostproc')
        self.capsFilter = self.gst.get_by_name('capsFilter')

    def update(self, caps, sampleSize: Tuple[int, int], options: scrypted_sdk.ImageOptions):
        sampleWidth, sampleHeight = sampleSize

        crop = options.get('crop')
        resize = options.get('resize')

        vaapipostproc = self.vaapipostproc

        if resize:
            width = resize.get('width')
            if width:
                xscale = resize['width'] / sampleWidth 
                height = sampleHeight * xscale

            height = resize.get('height')
            if height:
                yscale = resize['height'] / sampleHeight
                if not width:
                    width = sampleWidth * yscale

            width = int(width)
            height = int(height)

            outputWidth = width
            outputHeight = height
        else:
            outputWidth = 0
            outputHeight = 0

        # vaapipostproc.set_property('width', outputWidth)
        # vaapipostproc.set_property('height', outputHeight)

        # TODO: gray fast path?
        # not sure vaapi supports non-rgba across all hardware...
        # GST_VIDEO_FORMAT_RGBA (11) – rgb with alpha channel last
        # GST_VIDEO_FORMAT_GRAY8 (25) – 8-bit grayscale

        format = toCapsFormat(options)
        if format != 'GRAY8' and format != 'RGBA':
            format = 'RGBA'
        # should RGBA be forced? not sure all devices can handle gray8?
        format = 'RGBA'

        vaapipostproc.set_property('format', 11)
        self.capsFilter.set_property('caps', caps.from_string(f"video/x-raw,format={format},width={outputWidth},height={outputHeight}"))

        if crop:
            left = int(crop['left'])
            top = int(crop['top'])
            width = int(crop['width'])
            height = int(crop['height'])
            # right and bottom crop values are pixel distance from the corresponding edge,
            # not a bounding box
            right = sampleWidth - (left + width)
            bottom = sampleHeight - (top + height)
        else:
            left = 0
            top = 0
            right = 300
            bottom = 300

        vaapipostproc.set_property('crop-left', left)
        vaapipostproc.set_property('crop-top', top)
        vaapipostproc.set_property('crop-right', right)
        vaapipostproc.set_property('crop-bottom', bottom)

class OpenGLPostProcess():
    def __init__(self) -> None:
        self.postprocess = ' ! glcolorconvert ! gltransformation name=gltransformation ! glcolorscale ! capsfilter name=glCapsFilter caps="video/x-raw(memory:GLMemory),format=RGBA" ! gldownload'
        self.resize = None

    async def create(self, gst, pipeline: str):
        gst, gen = await createPipelineIterator(pipeline + self.postprocess, gst)
        g = gen()
        self.gst = gst
        self.g = g
        # positions/scales the input into target texture
        self.gltransformation = self.gst.get_by_name('gltransformation')
        # sets the target texture size
        self.glCapsFilter = self.gst.get_by_name('glCapsFilter')

    def update(self, caps, sampleSize: Tuple[int, int], options: scrypted_sdk.ImageOptions):
        sampleWidth, sampleHeight = sampleSize

        crop = options.get('crop')
        resize = options.get('resize')

        glCaps = "video/x-raw(memory:GLMemory),format=RGBA"
        if resize:
            width = resize.get('width')
            if width:
                xscale = resize['width'] / sampleWidth 
                height = sampleHeight * xscale

            height = resize.get('height')
            if height:
                yscale = resize['height'] / sampleHeight
                if not width:
                    width = sampleWidth * yscale

            width = int(width)
            height = int(height)

            glCaps += f",width={width},height={height}"

        self.glCapsFilter.set_property('caps', caps.from_string(glCaps))

        if crop:
            left = int(crop['left'])
            top = int(crop['top'])
            width = int(crop['width'])
            height = int(crop['height'])

            scaleX = sampleWidth / width
            scaleY = sampleHeight / height

            # the default scale origin is the center.
            newCenterX = left + width / 2
            newCenterY = top + height / 2
            curCenterX = sampleWidth / 2
            curCenterY = sampleHeight / 2
            diffX = curCenterX - newCenterX
            diffY = curCenterY - newCenterY
            translationX = diffX / width
            translationY = diffY / height
        else:
            scaleX = 1
            scaleY = 1
            translationX = 0
            translationY = 0

        gltransformation = self.gltransformation
        gltransformation.set_property('scale-x', scaleX)
        gltransformation.set_property('scale-y', scaleY)
        gltransformation.set_property('translation-x', translationX)
        gltransformation.set_property('translation-y', translationY)
