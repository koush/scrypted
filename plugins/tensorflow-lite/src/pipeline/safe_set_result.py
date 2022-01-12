from asyncio.futures import Future
from asyncio import AbstractEventLoop

def safe_set_result(loop: AbstractEventLoop, future: Future):
    def loop_set_result():
        try:
            if not future.done():
                future.set_result(None)
        except:
            pass
    loop.call_soon_threadsafe(loop_set_result)
