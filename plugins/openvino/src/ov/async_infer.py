import asyncio

async def start_async(infer_request):
    future = asyncio.Future(loop = asyncio.get_event_loop())
    def callback(status = None, result = None):
        future.set_result(None)
    infer_request.set_callback(callback, None)
    infer_request.start_async()
    await future
