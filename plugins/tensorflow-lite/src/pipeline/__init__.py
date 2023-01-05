from asyncio.events import AbstractEventLoop
from asyncio.futures import Future
import threading

import gi
gi.require_version('Gst', '1.0')
gi.require_version('GstBase', '1.0')

from .safe_set_result import safe_set_result
from gi.repository import GObject, Gst
import math
import asyncio

GObject.threads_init()
Gst.init(None)

class GstPipelineBase:
    def __init__(self, loop: AbstractEventLoop, finished: Future) -> None:
        self.loop = loop
        self.finished = finished
        self.gst = None

    def attach_launch(self, gst):
        self.gst = gst

    def parse_launch(self, pipeline: str):
        self.attach_launch(Gst.parse_launch(pipeline))

        # Set up a pipeline bus watch to catch errors.
        self.bus = self.gst.get_bus()
        self.watchId = self.bus.connect('message', self.on_bus_message)
        self.bus.add_signal_watch()

    def on_bus_message(self, bus, message):
        # seeing the following error on pi 32 bit
        # OverflowError: Python int too large to convert to C long
        t = str(message.type)
        if t == str(Gst.MessageType.EOS):
            safe_set_result(self.loop, self.finished)
        elif t == str(Gst.MessageType.WARNING):
            err, debug = message.parse_warning()
            print('Warning: %s: %s\n' % (err, debug))
        elif t == str(Gst.MessageType.ERROR):
            err, debug = message.parse_error()
            print('Error: %s: %s\n' % (err, debug))
            safe_set_result(self.loop, self.finished)
        return True

    async def run_attached(self):
        try:
            await self.finished
        except:
            pass

    async def run(self):
        # Run pipeline.
        self.gst.set_state(Gst.State.PLAYING)

        try:
            await self.run_attached()
        finally:
            # Clean up.
            self.bus.remove_signal_watch()
            self.bus.disconnect(self.watchId)
            self.gst.set_state(Gst.State.NULL)
            self.bus = None
            self.watchId = None
            self.gst = None


class GstPipeline(GstPipelineBase):
    def __init__(self, loop: AbstractEventLoop, finished: Future, appsink_name: str, user_callback, crop=False):
        super().__init__(loop, finished)
        self.appsink_name = appsink_name
        self.user_callback = user_callback
        self.running = False
        self.gstsample = None
        self.sink_size = None
        self.src_size = None
        self.dst_size = None
        self.pad_size = None
        self.scale_size = None
        self.crop = crop
        self.condition = None

    def attach_launch(self, gst):
        super().attach_launch(gst)

        appsink = self.gst.get_by_name(self.appsink_name)
        appsink.connect('new-preroll', self.on_new_sample, True)
        appsink.connect('new-sample', self.on_new_sample, False)

    async def run_attached(self):
        # Start inference worker.
        self.running = True
        worker = threading.Thread(target=self.inference_main)
        worker.start()
        while not self.condition:
            await asyncio.sleep(10)

        await super().run_attached()

        async def notifier(): 
            self.running = False
            async with self.condition:
                self.condition.notify_all()
        asyncio.run_coroutine_threadsafe(notifier(), loop = self.selfLoop)

        # we should join, but this blocks the asyncio thread.
        # worker.join()

    def on_new_sample(self, sink, preroll):
        sample = sink.emit('pull-preroll' if preroll else 'pull-sample')
        if not self.sink_size:
            s = sample.get_caps().get_structure(0)
            self.sink_size = (s.get_value('width'), s.get_value('height'))
        self.gstsample = sample
        async def notifier(): 
            async with self.condition:
                self.condition.notify_all()
        asyncio.run_coroutine_threadsafe(notifier(), loop = self.selfLoop)
        # should block?
        return Gst.FlowReturn.OK

    def get_src_size(self):
        if not self.src_size:
            videoconvert = self.gst.get_by_name('videoconvert')
            structure = videoconvert.srcpads[0].get_current_caps(
            ).get_structure(0)
            _, w = structure.get_int('width')
            _, h = structure.get_int('height')
            self.src_size = (w, h)

            videoscale = self.gst.get_by_name('videoscale')
            structure = videoscale.srcpads[0].get_current_caps(
            ).get_structure(0)
            _, w = structure.get_int('width')
            _, h = structure.get_int('height')
            self.dst_size = (w, h)

            appsink = self.gst.get_by_name(self.appsink_name)
            structure = appsink.sinkpads[0].get_current_caps().get_structure(0)
            _, w = structure.get_int('width')
            _, h = structure.get_int('height')
            self.dst_size = (w, h)

            # the dimension with the higher scale value got cropped or boxed.
            # use the other dimension to figure out the crop/box amount.
            scales = (self.dst_size[0] / self.src_size[0],
                      self.dst_size[1] / self.src_size[1])
            if self.crop:
                scale = max(scales[0], scales[1])
            else:
                scale = min(scales[0], scales[1])
            self.scale_size = scale

            dx = self.src_size[0] * scale
            dy = self.src_size[1] * scale

            px = math.ceil((self.dst_size[0] - dx) / 2)
            py = math.ceil((self.dst_size[1] - dy) / 2)

            self.pad_size = (px, py)

        return self.src_size

    def convert_to_src_size(self, point, normalize=False):
        valid = True
        px, py = self.pad_size
        x, y = point

        if normalize:
            x = max(0, x)
            x = min(x, self.src_size[0] - 1)
            y = max(0, y)
            y = min(y, self.src_size[1] - 1)

        x = (x - px) / self.scale_size
        if x < 0:
            x = 0
            valid = False
        if x >= self.src_size[0]:
            x = self.src_size[0] - 1
            valid = False

        y = (y - py) / self.scale_size
        if y < 0:
            y = 0
            valid = False
        if y >= self.src_size[1]:
            y = self.src_size[1] - 1
            valid = False

        return (int(math.ceil(x)), int(math.ceil(y)), valid)


    def inference_main(self):
        loop = asyncio.new_event_loop()
        self.selfLoop = loop
        self.condition = asyncio.Condition(loop = loop)
        loop.run_until_complete(self.inference_loop())
        loop.close()

    async def inference_loop(self):
        while self.running:
            async with self.condition:
                while not self.gstsample and self.running:
                    await self.condition.wait()
                if not self.running:
                    return
                gstsample = self.gstsample
                self.gstsample = None
            try:
                await self.user_callback(gstsample, self.get_src_size(
                ), lambda p, normalize=False: self.convert_to_src_size(p, normalize))
            except:
                print("callback failure")
                raise


def get_dev_board_model():
    try:
        model = open('/sys/firmware/devicetree/base/model').read().lower()
        if 'mx8mq' in model:
            return 'mx8mq'
        if 'mt8167' in model:
            return 'mt8167'
    except:
        pass
    return None


def create_pipeline_sink(
        appsink_name,
        appsink_size,
        pixel_format,
        crop=False):
    SINK_ELEMENT = 'appsink name={appsink_name} emit-signals=true max-buffers=-1 drop=true sync=false'.format(
        appsink_name=appsink_name)

    (width, height) = appsink_size

    SINK_CAPS = 'video/x-raw,format={pixel_format}'
    if width and height:
        SINK_CAPS += ',width={width},height={height},pixel-aspect-ratio=1/1'

    sink_caps = SINK_CAPS.format(
        width=width, height=height, pixel_format=pixel_format)
    pipeline = " {sink_caps} ! {sink_element}".format(
        sink_caps=sink_caps,
        sink_element=SINK_ELEMENT)

    return pipeline


def create_pipeline(
        appsink_name,
        appsink_size,
        video_input,
        pixel_format,
        crop=False,
        parse_only=False):
    if parse_only:
        sink = 'appsink name={appsink_name} emit-signals=true sync=false'.format(
            appsink_name=appsink_name)
        PIPELINE = """ {video_input}
            ! {sink}
        """
    else:
        sink = create_pipeline_sink(
            appsink_name, appsink_size, pixel_format, crop=crop)
        if crop:
            PIPELINE = """ {video_input} ! queue leaky=downstream max-size-buffers=0 ! videoconvert name=videoconvert ! aspectratiocrop aspect-ratio=1/1 ! videoscale name=videoscale ! queue leaky=downstream max-size-buffers=0
                ! {sink}
            """
        else:
            PIPELINE = """ {video_input} ! queue leaky=downstream max-size-buffers=0 ! videoconvert name=videoconvert ! videoscale name=videoscale ! queue leaky=downstream max-size-buffers=0
                ! {sink}
            """
    pipeline = PIPELINE.format(video_input=video_input, sink=sink)
    print('Gstreamer pipeline:\n', pipeline)
    return pipeline


def run_pipeline(loop, finished,
                 user_callback,
                 appsink_name,
                 appsink_size,
                 video_input,
                 pixel_format,
                 crop=False,
                 parse_only=False):
    gst = GstPipeline(loop, finished, appsink_name, user_callback, crop=crop)
    pipeline = create_pipeline(
        appsink_name, appsink_size, video_input, pixel_format, crop=crop, parse_only=parse_only)
    gst.parse_launch(pipeline)
    return gst
