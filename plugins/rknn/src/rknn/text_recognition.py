import asyncio
import concurrent.futures
import math
import os
import threading
import traceback
from typing import Any, Callable, List

import numpy as np
from PIL import Image, ImageOps
from rknnlite.api import RKNNLite

from common.text import skew_image, crop_text, calculate_y_change
from predict import Prediction
from predict.rectangle import Rectangle
from predict.text_recognize import TextRecognition
import scrypted_sdk
from scrypted_sdk.types import ObjectsDetected, ObjectDetectionResult
import det_utils.operators
import det_utils.db_postprocess
import rec_utils.operators
import rec_utils.rec_postprocess


TEXT_RECOGNITION_NATIVE_ID = "textrecognition"
DET_IMG_SIZE = (480, 480)

RKNN_DET_PREPROCESS_CONFIG = [
    {
        'DetResizeForTest': {
            'image_shape': DET_IMG_SIZE
        }
    },
    {
        'NormalizeImage': {
            'std': [1., 1., 1.],
            'mean': [0., 0., 0.],
            'scale': '1.',
            'order': 'hwc'
        }
    }
]

RKNN_DET_POSTPROCESS_CONFIG = {
    'DBPostProcess': {
        'thresh': 0.3,
        'box_thresh': 0.6,
        'max_candidates': 1000,
        'unclip_ratio': 1.5,
        'use_dilation': False,
        'score_mode': 'fast',
    }
}

RKNN_REC_PREPROCESS_CONFIG = [
    {
        'NormalizeImage': {
            'std': [1, 1, 1],
            'mean': [0, 0, 0],
            'scale': '1./255.',
            'order': 'hwc'
        }
    }
]

RKNN_REC_POSTPROCESS_CONFIG = {
    'CTCLabelDecode':{
        "character_dict_path": None, # will be replaced by RKNNDetection.__init__()
        "use_space_char": True
    }
}

rknn_verbose = False
model_download_tmpl = 'https://github.com/bjia56/scrypted-rknn/raw/main/models/{}_{}.rknn'
chardict_link = 'https://github.com/bjia56/scrypted-rknn/raw/main/models/ppocr_keys_v1.txt'


class RKNNText:
    model_path: str
    rknn_runtimes: dict
    executor: concurrent.futures.ThreadPoolExecutor
    preprocess_funcs: List[Callable]
    postprocess_func: Callable
    print: Callable

    def __init__(self, model_path, print) -> None:
        self.model_path = model_path
        self.rknn_runtimes = {}
        self.print = print

        if not self.model_path:
            raise ValueError('model_path is not set')

        def executor_initializer():
            thread_name = threading.current_thread().name
            rknn = RKNNLite(verbose=rknn_verbose)
            ret = rknn.load_rknn(self.model_path)
            if ret != 0:
                raise RuntimeError('Failed to load model: {}'.format(ret))

            ret = rknn.init_runtime()
            if ret != 0:
                raise RuntimeError('Failed to init runtime: {}'.format(ret))

            self.rknn_runtimes[thread_name] = rknn
            self.print('RKNNLite runtime initialized on thread {}'.format(thread_name))

        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=3, thread_name_prefix=type(self).__name__, initializer=executor_initializer)

    def detect(self, img):
        def do_detect(img):
            model_input = img
            for p in self.preprocess_funcs:
                model_input = p(model_input)

            rknn = self.rknn_runtimes[threading.current_thread().name]
            output = rknn.inference(inputs=[np.expand_dims(model_input['image'], axis=0)])

            return self.postprocess_func(output, model_input['shape'], model_input['image'].shape)

        future = self.executor.submit(do_detect, {'image': img, 'shape': img.shape})
        return future


class RKNNDetection(RKNNText):
    db_preprocess = None
    det_postprocess = None

    def __init__(self, model_path, print):
        super().__init__(model_path, print)

        self.preprocess_funcs = []
        for item in RKNN_DET_PREPROCESS_CONFIG:
            for key in item:
                pclass = getattr(det_utils.operators, key)
                p = pclass(**item[key])
                self.preprocess_funcs.append(p)

        self.db_postprocess = det_utils.db_postprocess.DBPostProcess(**RKNN_DET_POSTPROCESS_CONFIG['DBPostProcess'])
        self.det_postprocess = det_utils.db_postprocess.DetPostProcess()

        def postprocess(output, model_shape, img_shape):
            preds = {'maps': output[0].astype(np.float32)}
            result = self.db_postprocess(preds, model_shape)
            return self.det_postprocess.filter_tag_det_res(result[0]['points'], img_shape)
        self.postprocess_func = postprocess


class RKNNRecognition(RKNNText):
    ctc_postprocess = None

    def __init__(self, model_path, print):
        super().__init__(model_path, print)

        self.preprocess_funcs = []
        for item in RKNN_REC_PREPROCESS_CONFIG:
            for key in item:
                pclass = getattr(rec_utils.operators, key)
                p = pclass(**item[key])
                self.preprocess_funcs.append(p)

        self.ctc_postprocess = rec_utils.rec_postprocess.CTCLabelDecode(**RKNN_REC_POSTPROCESS_CONFIG['CTCLabelDecode'])

        def postprocess(output, model_shape, img_shape):
            preds = output[0].astype(np.float32)
            output = self.ctc_postprocess(preds)
            return output
        self.postprocess_func = postprocess


async def prepare_text_result(d: ObjectDetectionResult, image: scrypted_sdk.Image, skew_angle: float):
    textImage = await crop_text(d, image)

    skew_height_change = calculate_y_change(d["boundingBox"][3], skew_angle)
    skew_height_change = math.floor(skew_height_change)
    textImage = skew_image(textImage, skew_angle)
    # crop skew_height_change from top
    if skew_height_change > 0:
        textImage = textImage.crop((0, 0, textImage.width, textImage.height - skew_height_change))
    elif skew_height_change < 0:
        textImage = textImage.crop((0, -skew_height_change, textImage.width, textImage.height))

    new_height = 48
    new_width = int(textImage.width * new_height / textImage.height)
    textImage = textImage.resize((new_width, new_height), resample=Image.LANCZOS).convert("L")

    new_width = 320
    # calculate padding dimensions
    padding = (0, 0, new_width - textImage.width, 0)
    # todo: clamp entire edge rather than just center
    edge_color = textImage.getpixel((textImage.width - 1, textImage.height // 2))
    # pad image
    textImage = ImageOps.expand(textImage, padding, fill=edge_color)
    # pil to numpy
    image_array = np.array(textImage)
    image_array = image_array.reshape(textImage.height, textImage.width, 1)
    image_tensor = image_array#.transpose((2, 0, 1)) / 255

    # test normalize contrast
    # image_tensor = (image_tensor - np.min(image_tensor)) / (np.max(image_tensor) - np.min(image_tensor))

    image_tensor = (image_tensor - 0.5) / 0.5

    return image_tensor


class TextRecognition(TextRecognition):
    detection: RKNNDetection
    recognition: RKNNRecognition

    def __init__(self, nativeId=None, cpu=""):
        super().__init__(nativeId)

        model_download = model_download_tmpl.format("ppocrv4_det", cpu)
        model_file = os.path.basename(model_download)
        det_model_path = self.downloadFile(model_download, model_file)

        model_download = model_download_tmpl.format("ppocrv4_rec", cpu)
        model_file = os.path.basename(model_download)
        rec_model_path = self.downloadFile(model_download, model_file)

        chardict_file = os.path.basename(chardict_link)
        chardict_path = self.downloadFile(chardict_link, chardict_file)
        RKNN_REC_POSTPROCESS_CONFIG['CTCLabelDecode']['character_dict_path'] = chardict_path

        self.detection = RKNNDetection(det_model_path, lambda *args, **kwargs: self.print(*args, **kwargs))
        self.recognition = RKNNRecognition(rec_model_path, lambda *args, **kwargs: self.print(*args, **kwargs))
        self.inputheight = DET_IMG_SIZE[0]
        self.inputwidth = DET_IMG_SIZE[1]

    async def detect_once(self, input: Image, settings: Any, src_size, cvss) -> ObjectsDetected:
        detections = await asyncio.wrap_future(
            self.detection.detect(np.array(input)), loop=asyncio.get_event_loop()
        )

        #self.print(detections)

        predictions: List[Prediction] = []
        for box in detections:
            #self.print(box)
            tl, tr, br, bl = box
            l = min(tl[0], bl[0])
            t = min(tl[1], tr[1])
            r = max(tr[0], br[0])
            b = max(bl[1], br[1])

            pred = Prediction(0, 1, Rectangle(l, t, r, b))
            predictions.append(pred)

        return self.create_detection_result(predictions, src_size, cvss)

    async def setLabel(
        self, d: ObjectDetectionResult, image: scrypted_sdk.Image, skew_angle: float
    ):
        try:
            image_tensor = await prepare_text_result(d, image, skew_angle)
            preds = await asyncio.wrap_future(
                self.recognition.detect(image_tensor), loop=asyncio.get_event_loop()
            )
            #self.print("preds", preds)
            d["label"] = preds[0][0]
        except Exception as e:
            traceback.print_exc()
            pass
