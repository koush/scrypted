from PIL import Image, ImageOps
from scrypted_sdk import (
    ObjectDetectionResult,
)
import scrypted_sdk
import numpy as np
from common.softmax import softmax
from common.colors import ensureRGBData
import math

def skew_image(image: Image, skew_angle_rad: float):
    skew_matrix = [1, 0, 0, skew_angle_rad, 1, 0]

    # Apply the transformation
    skewed_image = image.transform(
        image.size, Image.AFFINE, skew_matrix, resample=Image.BICUBIC
    )

    return skewed_image

async def crop_text(d: ObjectDetectionResult, image: scrypted_sdk.Image):
    l, t, w, h = d["boundingBox"]
    l = max(0, math.floor(l))
    t = max(0, math.floor(t))
    w = math.floor(w)
    h = math.floor(h)
    if l + w > image.width:
        w = image.width - l
    if t + h > image.height:
        h = image.height - t
    format = image.format or 'rgb'
    cropped = await image.toBuffer(
        {
            "crop": {
                "left": l,
                "top": t,
                "width": w,
                "height": h,
            },
            "format": format,
        }
    )
    pilImage = await ensureRGBData(cropped, (w, h), format)
    return pilImage

def calculate_y_change(original_height, skew_angle_radians):
    # Calculate the change in y-position
    y_change = original_height * math.tan(skew_angle_radians)
    
    return y_change

async def prepare_text_result(d: ObjectDetectionResult, image: scrypted_sdk.Image, skew_angle: float, deskew_height: float):
    textImage = await crop_text(d, image)

    skew_height_change = calculate_y_change(d["boundingBox"][3], skew_angle)
    skew_height_change = math.floor(skew_height_change)
    textImage = skew_image(textImage, skew_angle)
    # crop skew_height_change from top
    if skew_height_change > 0:
        textImage = textImage.crop((0, 0, textImage.width, deskew_height))
    elif skew_height_change < 0:
        textImage = textImage.crop((0, textImage.height - deskew_height, textImage.width, textImage.height))

    target_height = 64
    height_padding = 3
    new_height = target_height - height_padding * 2
    new_width = int(textImage.width * new_height / textImage.height)
    textImage = textImage.resize((new_width, new_height), resample=Image.LANCZOS).convert("L")

    new_width = 384
    # average the top pixels
    edge_color = textImage.getpixel((0, textImage.height // 2))
    # average the bottom pixels
    edge_color += textImage.getpixel((textImage.width - 1, textImage.height // 2))
    # average the right pixels
    edge_color += textImage.getpixel((textImage.width // 2, 0))
    # average the left pixels
    edge_color += textImage.getpixel((textImage.width // 2, textImage.height - 1))
    edge_color = edge_color // 4

    # calculate padding dimensions
    padding = (0, height_padding, new_width - textImage.width, height_padding)
    # pad image
    textImage = ImageOps.expand(textImage, padding, fill=edge_color)
    # pil to numpy
    image_array = np.array(textImage)
    image_array = image_array.reshape(textImage.height, textImage.width, 1)
    image_tensor = image_array.transpose((2, 0, 1)) / 255

    # test normalize contrast
    # image_tensor = (image_tensor - np.min(image_tensor)) / (np.max(image_tensor) - np.min(image_tensor))

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
