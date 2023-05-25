import scrypted_sdk
from typing import Tuple
from gst_generator import createPipelineIterator

class GstreamerPostProcess():
    def __init__(self) -> None:
        self.postprocess = ' ! videoconvert ! videocrop name=videocrop ! videoscale ! capsfilter name=capsfilter'
        self.resize = None

    async def create(self, gst, pipeline: str):
        gst, gen = await createPipelineIterator(pipeline + self.postprocess, gst)
        g = gen()
        self.gst = gst
        self.g = g
        self.videocrop = self.gst.get_by_name('videocrop')
        self.capsfilter = self.gst.get_by_name('capsfilter')

    def update(self, caps, sampleSize: Tuple[int, int], options: scrypted_sdk.ImageOptions = None, format: str = None):
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

        sinkCaps = "video/x-raw"
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
            sinkCaps += f",width={width},height={height}"

        if format:
            sinkCaps += f",format={format}"

        self.capsfilter.set_property('caps', caps.from_string(sinkCaps))

class VaapiPostProcess():
    def __init__(self) -> None:
        self.postprocess = ' ! vaapipostproc name=vaapipostproc'
        self.resize = None

    async def create(self, gst, pipeline: str):
        gst, gen = await createPipelineIterator(pipeline + self.postprocess, gst)
        g = gen()
        self.gst = gst
        self.g = g
        self.vaapipostproc = self.gst.get_by_name('vaapipostproc')

    def update(self, caps, sampleSize: Tuple[int, int], options: scrypted_sdk.ImageOptions = None, format: str = None):
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

        vaapipostproc.set_property('width', outputWidth)
        vaapipostproc.set_property('height', outputHeight)

        if format:
            if format == 'RGB':
                format = 'RGBA'
        vaapipostproc.set_property('format', 11)

        if False and crop:
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

        print(left, top, right, bottom)
        vaapipostproc.set_property('crop-left', left)
        vaapipostproc.set_property('crop-top', top)
        vaapipostproc.set_property('crop-right', right)
        vaapipostproc.set_property('crop-bottom', bottom)

class AppleMediaPostProcess():
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
        # sets output format to something other than RGBA if necessary since gl can't handle non-RGBA
        # self.swCapsFilter = self.gst.get_by_name('swCapsFilter')


    def update(self, caps, sampleSize: Tuple[int, int], options: scrypted_sdk.ImageOptions = None, format: str = None):
        # print(options)
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

            # pipeline += " ! videoscale"
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

        # if format and format != 'RGBA':
        #     swcaps = f'video/x-raw,format={format}'
        #     print(swcaps)
        #     self.swCapsFilter.set_property('caps', caps.from_string(swcaps))
        # else:
        #     self.swCapsFilter.set_property('caps', 'video/x-raw')
        #     print('nc')
