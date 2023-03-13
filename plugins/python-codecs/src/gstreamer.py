import concurrent.futures
import threading
import asyncio
from queue import Queue

try:
    import gi
    gi.require_version('Gst', '1.0')
    gi.require_version('GstBase', '1.0')

    from gi.repository import GLib, GObject, Gst
    GObject.threads_init()
    Gst.init(None)
except:
    pass

class Callback:
    def __init__(self, callback) -> None:
        self.loop = asyncio.get_event_loop()
        self.callback = callback

def createPipelineIterator(pipeline: str):
    pipeline = '{pipeline} ! queue leaky=downstream max-size-buffers=0 ! appsink name=appsink emit-signals=true sync=false max-buffers=-1 drop=true'.format(pipeline=pipeline)
    print(pipeline)
    gst = Gst.parse_launch(pipeline)
    bus = gst.get_bus()

    def on_bus_message(bus, message):
        t = str(message.type)
        print(t)
        if t == str(Gst.MessageType.EOS):
            finish()
        elif t == str(Gst.MessageType.WARNING):
            err, debug = message.parse_warning()
            print('Warning: %s: %s\n' % (err, debug))
        elif t == str(Gst.MessageType.ERROR):
            err, debug = message.parse_error()
            print('Error: %s: %s\n' % (err, debug))
            finish()

    def stopGst():
        bus.remove_signal_watch()
        bus.disconnect(watchId)
        gst.set_state(Gst.State.NULL)

    def finish():
        nonlocal hasFinished
        hasFinished = True
        callback = Callback(None)
        callbackQueue.put(callback)
        if not asyncFuture.done():
            asyncFuture.set_result(None)
        if not finished.done():
            finished.set_result(None)

    watchId = bus.connect('message', on_bus_message)
    bus.add_signal_watch()

    finished = concurrent.futures.Future()
    finished.add_done_callback(lambda _: threading.Thread(target=stopGst).start())
    hasFinished = False

    appsink = gst.get_by_name('appsink')
    callbackQueue = Queue()
    asyncFuture = asyncio.Future()

    async def gen():
        try:      
            while True:
                nonlocal asyncFuture
                asyncFuture = asyncio.Future()
                yieldFuture = asyncio.Future()
                async def asyncCallback(sample):
                    asyncFuture.set_result(sample)
                    await yieldFuture
                callbackQueue.put(Callback(asyncCallback))
                sample = await asyncFuture
                if not sample:
                    yieldFuture.set_result(None)
                    break
                try:
                    yield sample
                finally:
                    yieldFuture.set_result(None)
        finally:
            finish()
            print('finished')


    def on_new_sample(sink, preroll):
        nonlocal hasFinished

        sample = sink.emit('pull-preroll' if preroll else 'pull-sample')

        callback: Callback = callbackQueue.get()
        if not callback.callback or hasFinished:
            hasFinished = True
            if callback.callback:
                print('erpasd')
                asyncio.run_coroutine_threadsafe(callback.callback(None), loop = callback.loop)
            return Gst.FlowReturn.OK

        future = asyncio.run_coroutine_threadsafe(callback.callback(sample), loop = callback.loop)
        try:
            future.result()
        except:
            pass
        return Gst.FlowReturn.OK

    appsink.connect('new-preroll', on_new_sample, True)
    appsink.connect('new-sample', on_new_sample, False)

    gst.set_state(Gst.State.PLAYING)
    return gst, gen

def mainThread():
    async def asyncMain():
        gst, gen = createPipelineIterator('rtspsrc location=rtsp://localhost:59668/18cc179a814fd5b3 ! rtph264depay ! h264parse ! vtdec_hw ! videoconvert ! video/x-raw')
        i = 0
        async for sample in gen():
            print('sample')
            i = i + 1
            if i == 10:
                break

    loop = asyncio.new_event_loop()
    asyncio.ensure_future(asyncMain(), loop = loop)
    loop.run_forever()

if __name__ == "__main__":
    threading.Thread(target = mainThread).start()
    mainLoop = GLib.MainLoop()
    mainLoop.run()
