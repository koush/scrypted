from __future__ import annotations
import scrypted_sdk
import numpy as np
import re
from pycoral.utils.dataset import read_label_file
from pycoral.utils.edgetpu import make_interpreter
from pycoral.utils.edgetpu import run_inference
from pycoral.adapters.common import input_size
from pycoral.adapters.classify import get_classes
from pycoral.adapters import detect
from PIL import Image
import common
import io
import gstreamer
import json
import asyncio

from scrypted_sdk.types import FFMpegInput, MediaObject, ObjectDetection, ObjectDetectionSession, OnOff, ObjectsDetected, ScryptedMimeTypes

def parse_label_contents(contents: str):
    lines = contents.splitlines()
    ret = {}
    for row_number, content in enumerate(lines):
        pair = re.split(r'[:\s]+', content.strip(), maxsplit=1)
        if len(pair) == 2 and pair[0].strip().isdigit():
            ret[int(pair[0])] = pair[1].strip()
        else:
            ret[row_number] = content.strip()
    return ret


class PythonLight(scrypted_sdk.ScryptedDeviceBase, ObjectDetection):
    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)
        labels_contents = scrypted_sdk.zip.open('fs/coco_labels.txt').read().decode('utf8')
        self.labels = parse_label_contents(labels_contents)
        model = scrypted_sdk.zip.open('fs/mobilenet_ssd_v2_coco_quant_postprocess_edgetpu.tflite').read()
        self.interpreter = make_interpreter(model)
        self.interpreter.allocate_tensors()

        _, height, width, channels = self.interpreter.get_input_details()[0]['shape']
        print("%s, %s, %s" % (width, height, channels))

    async def detectObjectsImage(self, image: Image) -> ObjectsDetected:
        _, scale = common.set_resized_input(self.interpreter, image.size, lambda size: image.resize(size, Image.ANTIALIAS))        
        self.interpreter.invoke()
        objs = detect.get_objects(self.interpreter, .4, scale)
        for obj in objs:
            print(self.labels.get(obj.id, obj.id))
            print('  id:    ', obj.id)
            print('  score: ', obj.score)
            print('  bbox:  ', obj.bbox)

    async def detectObjects(self, mediaObject: MediaObject, session: ObjectDetectionSession = None) -> ObjectsDetected:
        if mediaObject.mimeType.startswith('image/'):
            stream = io.BytesIO(bytes(await scrypted_sdk.mediaManager.convertMediaObjectToBuffer(mediaObject, 'image/jpeg')))
            image = Image.open(stream)

            _, scale = common.set_resized_input(self.interpreter, image.size, lambda size: image.resize(size, Image.ANTIALIAS))        

            # self.thing(tensor)
            self.interpreter.invoke()

            objs = detect.get_objects(self.interpreter, .4, scale)

            for obj in objs:
                print(self.labels.get(obj.id, obj.id))
                print('  id:    ', obj.id)
                print('  score: ', obj.score)
                print('  bbox:  ', obj.bbox)

            return


        b = await scrypted_sdk.mediaManager.convertMediaObjectToBuffer(mediaObject, ScryptedMimeTypes.MediaStreamUrl.value)
        s = b.decode('utf8')
        j: FFMpegInput = json.loads(s)
        print(j)
        size = j['mediaStreamOptions']['video']
        inference_size = input_size(self.interpreter)
        width, height = inference_size
        w, h = (size['width'], size['height'])
        scale = min(width / w, height / h)

        def user_callback(input_tensor, src_size, inference_box):
            run_inference(self.interpreter, input_tensor)

            objs = detect.get_objects(self.interpreter, .4, (scale, scale))

            for obj in objs:
                print(self.labels.get(obj.id, obj.id))
                print('  id:    ', obj.id)
                print('  score: ', obj.score)
                print('  bbox:  ', obj.bbox)

            # print(input_tensor)

        future = asyncio.Future()
        asyncio.get_event_loop().call_later(10, lambda: future.set_result(None))

        pipeline = gstreamer.run_pipeline(future, user_callback,
                                        src_size=(size['width'], size['height']),
                                        appsink_size=inference_size,
                                        videosrc=j['url'])
        task = pipeline.run()
        asyncio.ensure_future(task)
        # gstreamer.run_pipeline(user_callback, (size['width'], size['height']), inference_size, j['url'], headless = True)

        # # run_inference(self.interpreter, reshaped)
        # results = get_classes(self.interpreter, 3, .1)
        # text_lines = [
        #     ' ',
        # ]
        # for result in results:
        #     text_lines.append('score={:.2f}: {}'.format(result.score, self.labels.get(result.id, result.id)))
        # print(' '.join(text_lines))

def create_scrypted_plugin():
    return PythonLight()
