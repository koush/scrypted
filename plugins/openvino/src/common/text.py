from PIL import Image, ImageOps
from scrypted_sdk import (
    Setting,
    SettingValue,
    ObjectDetectionSession,
    ObjectsDetected,
    ObjectDetectionResult,
)
import scrypted_sdk
import numpy as np
from common.softmax import softmax

async def crop_text(d: ObjectDetectionResult, image: scrypted_sdk.Image, width: int, height: int):
    l, t, w, h = d["boundingBox"]
    cropped = await image.toBuffer(
        {
            "crop": {
                "left": l,
                "top": t,
                "width": w,
                "height": h,
            },
            "resize": {
                "width": width,
                "height": height,
            },
            "format": "gray",
        }
    )
    pilImage = Image.frombuffer("L", (width, height), cropped)
    return pilImage

async def prepare_text_result(d: ObjectDetectionResult, image: scrypted_sdk.Image):
    new_height = 64
    new_width = int(d["boundingBox"][2] * new_height / d["boundingBox"][3])
    textImage = await crop_text(d, image, new_width, new_height)
    new_width = 256
    # calculate padding dimensions
    padding = (0, 0, new_width - textImage.width, 0)
    # todo: clamp entire edge rather than just center
    edge_color = textImage.getpixel((textImage.width - 1, textImage.height // 2))
    # pad image
    textImage = ImageOps.expand(textImage, padding, fill=edge_color)
    # pil to numpy
    image_array = np.array(textImage)
    image_array = image_array.reshape(textImage.height, textImage.width, 1)
    image_tensor = image_array.transpose((2, 0, 1)) / 255
    image_tensor = (image_tensor - 0.5) / 0.5

    image_tensor = np.expand_dims(image_tensor, axis=0)

    return image_tensor


characters = "0123456789!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~ €ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

dict_character = list(characters)
character = ["[blank]"] + dict_character  # dummy '[blank]' token for CTCLoss (index 0)

def decode_greedy(text_index, length):
    """convert text-index into text-label."""
    texts = []
    index = 0
    for l in length:
        t = text_index[index : index + l]
        # Returns a boolean array where true is when the value is not repeated
        a = np.insert(~((t[1:] == t[:-1])), 0, True)
        # Returns a boolean array where true is when the value is not in the ignore_idx list
        b = ~np.isin(t, np.array(""))
        # Combine the two boolean array
        c = a & b
        # Gets the corresponding character according to the saved indexes
        text = "".join(np.array(character)[t[c.nonzero()]])
        texts.append(text)
        index += l
    return texts

def process_text_result(preds):
    preds_size = preds.shape[1]

    # softmax preds using scipy
    preds_prob = softmax(preds, axis=2)
    # preds_prob = softmax(preds)
    pred_norm = np.sum(preds_prob, axis=2)
    preds_prob = preds_prob / np.expand_dims(pred_norm, axis=-1)

    preds_index = np.argmax(preds_prob, axis=2)
    preds_index = preds_index.reshape(-1)

    preds_str = decode_greedy(preds_index, np.array([preds_size]))
    # why index 0? are there multiple predictions?
    return preds_str[0].replace('[blank]', '')
