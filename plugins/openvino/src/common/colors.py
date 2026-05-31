import concurrent.futures
from PIL import Image
import asyncio
from typing import Tuple

# vips is already multithreaded, but needs to be kicked off the python asyncio thread.
toThreadExecutor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="image")

async def to_thread(f):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(toThreadExecutor, f)

async def ensureRGBData(data: bytes, size: Tuple[int, int], format: str):
    if format == 'rgb':
        return Image.frombuffer('RGB', size, data)

    def convert():
        rgba = Image.frombuffer('RGBA', size, data)
        try:
            return rgba.convert('RGB')
        finally:
            rgba.close()
    return await to_thread(convert)

async def ensureRGBAData(data: bytes, size: Tuple[int, int], format: str):
    if format == 'rgba':
        return Image.frombuffer('RGBA', size, data)

    # this path should never be possible as all the image sources should be capable of rgba.
    def convert():
        rgb = Image.frombuffer('RGB', size, data)
        try:
            return rgb.convert('RGBA')
        finally:
            rgb.close()
    return await to_thread(convert)

async def ensureYCbCrAData(data: bytes, size: Tuple[int, int], format: str):
    # if the format is already yuvj444p, just return the data as is.
    if format == 'yuvj444p':
        # return RGB as a hack to indicate the data is already yuv planar.
        return Image.frombuffer('RGB', size, data)

    def convert():
        if format == 'rgb':
            tmp = Image.frombuffer('RGB', size, data)
        else:
            tmp = Image.frombuffer('RGBA', size, data)

        try:
            return tmp.convert('YCbCr')
        finally:
            tmp.close()
    return await to_thread(convert)
