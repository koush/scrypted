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
from gi.repository import GLib, GObject, Gst
import math

GObject.threads_init()
Gst.init(None)

class GstPipeline:
    def __init__(self, finished: Future, pipeline, user_function):
        self.finished = finished
        self.user_function = user_function
        self.running = False
        self.gstsample = None
        self.sink_size = None
        self.src_size = None
        self.dst_size = None
        self.pad_size = None
        self.scale_size = None
        self.condition = threading.Condition()

        self.pipeline = Gst.parse_launch(pipeline)
        self.overlay = self.pipeline.get_by_name('overlay')
        self.gloverlay = self.pipeline.get_by_name('gloverlay')
        self.overlaysink = self.pipeline.get_by_name('overlaysink')

        appsink = self.pipeline.get_by_name('appsink')
        appsink.connect('new-preroll', self.on_new_sample, True)
        appsink.connect('new-sample', self.on_new_sample, False)

        # Set up a pipeline bus watch to catch errors.
        bus = self.pipeline.get_bus()
        bus.add_signal_watch()
        bus.connect('message', self.on_bus_message)

    async def run(self):
        # Start inference worker.
        self.running = True
        worker = threading.Thread(target=self.inference_loop)
        worker.start()

        # Run pipeline.
        self.pipeline.set_state(Gst.State.PLAYING)
        try:
            await self.finished
        except:
            pass

        # Clean up.
        self.pipeline.set_state(Gst.State.NULL)
        while GLib.MainContext.default().iteration(False):
            pass
        with self.condition:
            self.running = False
            self.condition.notify_all()
        # worker.join()

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
            videoconvert = self.pipeline.get_by_name('videoconvert')
            structure = videoconvert.srcpads[0].get_current_caps().get_structure(0)
            _, w = structure.get_int('width')
            _, h = structure.get_int('height')
            self.src_size = (w, h)

            videoscale = self.pipeline.get_by_name('videoscale')
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

    def convert_to_src_size(self, point):
        px, py = self.pad_size
        x, y = point

        x = (x - px) / self.scale_size
        if x < 0:
            x = 0
        if x >= self.src_size[0]:
            x = self.src_size[0] - 1

        y = (y - py) / self.scale_size
        if y < 0:
            y = 0
        if y >= self.src_size[1]:
            y = self.src_size[1] - 1

        return (int(math.ceil(x)), int(math.ceil(y)))

    def inference_loop(self):
        while True:
            with self.condition:
                while not self.gstsample and self.running:
                    self.condition.wait()
                if not self.running:
                    break
                gstsample = self.gstsample
                self.gstsample = None

            self.user_function(gstsample, self.get_src_size(), lambda p: self.convert_to_src_size(p))

def get_dev_board_model():
  try:
    model = open('/sys/firmware/devicetree/base/model').read().lower()
    if 'mx8mq' in model:
        return 'mx8mq'
    if 'mt8167' in model:
        return 'mt8167'
  except: pass
  return None

def run_pipeline(finished,
                 user_function,
                 appsink_size,
                 video_input,
                 pixel_format):
    PIPELINE = video_input

    PIPELINE += """ ! decodebin ! queue leaky=downstream max-size-buffers=10 ! videoconvert name=videoconvert ! videoscale name=videoscale
    ! queue leaky=downstream max-size-buffers=1 ! {sink_caps} ! {sink_element}
    """

    SINK_ELEMENT = 'appsink name=appsink emit-signals=true max-buffers=1 drop=true sync=false'
    SINK_CAPS = 'video/x-raw,format={pixel_format},width={width},height={height},pixel-aspect-ratio=1/1'
    LEAKY_Q = 'queue max-size-buffers=100 leaky=upstream'

    sink_caps = SINK_CAPS.format(width=appsink_size[0], height=appsink_size[1], pixel_format=pixel_format)
    pipeline = PIPELINE.format(leaky_q=LEAKY_Q,
        sink_caps=sink_caps,
        sink_element=SINK_ELEMENT)

    print('Gstreamer pipeline:\n', pipeline)

    pipeline = GstPipeline(finished, pipeline, user_function)
    return pipeline
