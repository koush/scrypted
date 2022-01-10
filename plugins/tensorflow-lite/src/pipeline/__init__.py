# Copyright 2019 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the 'License');
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an 'AS IS' BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from asyncio.futures import Future
import threading

import gi
gi.require_version('Gst', '1.0')
gi.require_version('GstBase', '1.0')

from .safe_set_result import safe_set_result
from gi.repository import GObject, Gst
import math

GObject.threads_init()
Gst.init(None)

class GstPipelineBase:
    def __init__(self, finished: Future) -> None:
        self.finished = finished
        self.gst = None

    def attach_launch(self, gst):
        self.gst = gst

    def parse_launch(self, pipeline: str):
        self.attach_launch(Gst.parse_launch(pipeline))

        # Set up a pipeline bus watch to catch errors.
        bus = self.gst.get_bus()
        bus.add_signal_watch()
        bus.connect('message', self.on_bus_message)

    def on_bus_message(self, bus, message):
        # seeing the following error on pi 32 bit
        # OverflowError: Python int too large to convert to C long
        t = str(message.type)
        if t == str(Gst.MessageType.EOS):
            safe_set_result(self.finished)
        elif t == str(Gst.MessageType.WARNING):
            err, debug = message.parse_warning()
            print('Warning: %s: %s\n' % (err, debug))
        elif t == str(Gst.MessageType.ERROR):
            err, debug = message.parse_error()
            print('Error: %s: %s\n' % (err, debug))
            safe_set_result(self.finished)
        return True

    async def run_attached(self):
        try:
            await self.finished
        except:
            pass

    async def run(self):
        # Run pipeline.
        self.gst.set_state(Gst.State.PLAYING)

        await self.run_attached()

        # Clean up.
        self.gst.set_state(Gst.State.NULL)

class GstPipeline(GstPipelineBase):
    def __init__(self, finished: Future, appsink_name: str, user_function):
        super().__init__(finished)
        self.appsink_name = appsink_name
        self.user_function = user_function
        self.running = False
        self.gstsample = None
        self.sink_size = None
        self.src_size = None
        self.dst_size = None
        self.pad_size = None
        self.scale_size = None
        self.condition = threading.Condition()

    def attach_launch(self, gst):
        super().attach_launch(gst)

        appsink = self.gst.get_by_name(self.appsink_name)
        appsink.connect('new-preroll', self.on_new_sample, True)
        appsink.connect('new-sample', self.on_new_sample, False)

    async def run_attached(self):
        # Start inference worker.
        self.running = True
        worker = threading.Thread(target=self.inference_loop)
        worker.start()

        await super().run_attached()

        with self.condition:
            self.running = False
            self.condition.notify_all()
        # we should join, but this blocks the asyncio thread.
        # worker.join()

    def on_new_sample(self, sink, preroll):
        sample = sink.emit('pull-preroll' if preroll else 'pull-sample')
        if not self.sink_size:
            s = sample.get_caps().get_structure(0)
            self.sink_size = (s.get_value('width'), s.get_value('height'))
        with self.condition:
            self.gstsample = sample
            self.condition.notify_all()
        return Gst.FlowReturn.OK

    def get_src_size(self):
        if not self.src_size:
            videoconvert = self.gst.get_by_name('videoconvert')
            structure = videoconvert.srcpads[0].get_current_caps().get_structure(0)
            _, w = structure.get_int('width')
            _, h = structure.get_int('height')
            self.src_size = (w, h)

            videoscale = self.gst.get_by_name('videoscale')
            structure = videoscale.srcpads[0].get_current_caps().get_structure(0)
            _, w = structure.get_int('width')
            _, h = structure.get_int('height')
            self.dst_size = (w, h)

            # the dimension with the higher scale value got cropped.
            # use the other dimension to figure out the crop amount.
            scales = (self.dst_size[0] / self.src_size[0], self.dst_size[1] / self.src_size[1])
            scale = min(scales[0], scales[1])
            self.scale_size = scale

            dx = self.src_size[0] * scale
            dy = self.src_size[1] * scale

            px = math.ceil((self.dst_size[0] - dx) / 2)
            py = math.ceil((self.dst_size[1] - dy) / 2)

            self.pad_size = (px, py)
            
        return self.src_size

    def convert_to_src_size(self, point, normalize = False):
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

    def inference_loop(self):
        while True:
            with self.condition:
                while not self.gstsample and self.running:
                    self.condition.wait()
                if not self.running:
                    break
                gstsample = self.gstsample
                self.gstsample = None

            self.user_function(gstsample, self.get_src_size(), lambda p, normalize=False: self.convert_to_src_size(p, normalize))

def get_dev_board_model():
  try:
    model = open('/sys/firmware/devicetree/base/model').read().lower()
    if 'mx8mq' in model:
        return 'mx8mq'
    if 'mt8167' in model:
        return 'mt8167'
  except: pass
  return None

def create_pipeline_sink(
                 appsink_name,
                 appsink_size,
                 pixel_format):
    SINK_ELEMENT = 'appsink name={appsink_name} emit-signals=true max-buffers=1 drop=true sync=false'.format(appsink_name=appsink_name)
    SINK_CAPS = 'video/x-raw,format={pixel_format},width={width},height={height},pixel-aspect-ratio=1/1'

    sink_caps = SINK_CAPS.format(width=appsink_size[0], height=appsink_size[1], pixel_format=pixel_format)
    pipeline = " {sink_caps} ! {sink_element}".format(
        sink_caps=sink_caps,
        sink_element=SINK_ELEMENT)

    return pipeline

def create_pipeline(
                 appsink_name,
                 appsink_size,
                 video_input,
                 pixel_format):
    sink = create_pipeline_sink(appsink_name, appsink_size, pixel_format)
    PIPELINE = """ {video_input} ! queue leaky=upstream max-size-buffers=1 ! videoconvert name=videoconvert ! videoscale name=videoscale
        ! {sink}
    """
    pipeline = PIPELINE.format(video_input = video_input, sink = sink)
    print('Gstreamer pipeline:\n', pipeline)
    return pipeline

def run_pipeline(finished,
                 user_function,
                 appsink_name,
                 appsink_size,
                 video_input,
                 pixel_format):
    gst = GstPipeline(finished, appsink_name, user_function)
    pipeline = create_pipeline(appsink_name, appsink_size, video_input, pixel_format)
    gst.parse_launch(pipeline)
    return gst
