import threading
import asyncio

async def run_coro_threadsafe(coro, other_loop, our_loop = None):
    """Schedules coro in other_loop, awaits until coro has run and returns
    its result.
    """
    loop = our_loop or asyncio.get_event_loop()

    # schedule coro safely in other_loop, get a concurrent.future back
    # NOTE run_coroutine_threadsafe requires Python 3.5.1
    fut = asyncio.run_coroutine_threadsafe(coro, other_loop)

    # set up a threading.Event that fires when the future is finished
    finished = threading.Event()
    def fut_finished_cb(_):
        finished.set()
    fut.add_done_callback(fut_finished_cb)

    # wait on that event in an executor, yielding control to our_loop
    await loop.run_in_executor(None, finished.wait)

    # coro's result is now available in the future object
    return fut.result()
