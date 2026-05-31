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
    Gst = None

async def createPipelineIterator(pipeline: str, gst = None):
    loop = asyncio.get_running_loop()
    pipeline = '{pipeline} ! appsink name=appsink emit-signals=true sync=false'.format(pipeline=pipeline)
    print(pipeline)
    finished = concurrent.futures.Future()

    if gst:
        bin = Gst.parse_bin_from_description(pipeline, False)
        gst.add(bin)
        gst = bin

        def stopGst():
            gst.set_state(Gst.State.NULL)

    else:
        gst = Gst.parse_launch(pipeline)

        def on_bus_message(bus, message):
            t = str(message.type)
            # print(t)
            if t == str(Gst.MessageType.EOS):
                print('EOS: Stream ended.')
                finish()
            elif t == str(Gst.MessageType.WARNING):
                err, debug = message.parse_warning()
                print('Warning: %s: %s\n' % (err, debug))
                print('Ending stream due to warning. If this camera is causing errors, switch to the libav decoder.');
                finish()
            elif t == str(Gst.MessageType.ERROR):
                err, debug = message.parse_error()
                print('Error: %s: %s\n' % (err, debug))
                finish()

        bus = gst.get_bus()
        watchId = bus.connect('message', on_bus_message)
        bus.add_signal_watch()

        def stopGst():
            bus.remove_signal_watch()
            bus.disconnect(watchId)
            gst.set_state(Gst.State.NULL)

    finished.add_done_callback(lambda _: threading.Thread(target=stopGst, name="StopGst").start())

    hasFinished = False
    def finish():
        nonlocal hasFinished
        hasFinished = True
        yieldQueue.put(None)
        asyncio.run_coroutine_threadsafe(sampleQueue.put(None), loop = loop)
        if not finished.done():
            finished.set_result(None)


    appsink = gst.get_by_name('appsink')
    yieldQueue = Queue()
    sampleQueue = asyncio.Queue()

    async def gen():
        try:      
            while True:
                try:
                    sample = await sampleQueue.get()
                    if not sample:
                        break
                    yield sample
                finally:
                    yieldQueue.put(None)
        finally:
            print('gstreamer finished')
            finish()


    def on_new_sample(sink):
        nonlocal hasFinished

        sample = sink.emit('pull-sample')

        if hasFinished:
            return Gst.FlowReturn.OK

        asyncio.run_coroutine_threadsafe(sampleQueue.put(sample), loop = loop)
        try:
            yieldQueue.get()
        except:
            pass
        return Gst.FlowReturn.OK

    appsink.connect('new-sample', on_new_sample)

    gst.set_state(Gst.State.PLAYING)
    return gst, gen

def mainThread():
    async def asyncMain():
        gst, gen = await createPipelineIterator('rtspsrc location=rtsp://localhost:63876/674e895e04ddfd15 ! rtph264depay ! h264parse ! vtdec_hw ! video/x-raw(memory:GLMemory)')
        i = 0
        first = True
        async for sample in gen():
            import time
            print(time.time())
            if first:
                first = False
            
            for i in range(1, 10):
                caps = sample.get_caps()
                p = "appsrc name=appsrc emit-signals=True is-live=True \
                    caps={caps} ! videocrop left=0 top=0 right=10 bottom=10 ! gldownload".format(caps = caps.to_string().replace(' ', ''))
                # p = "appsrc name=appsrc emit-signals=True is-live=True \
                #     caps={caps} ! gldownload !\
                #     videoconvert ! videoscale name=videoscale ! video/x-raw,format=RGB,width=640,height=480".format(caps = caps.to_string().replace(' ', ''))
                gst2, gen2 = await createPipelineIterator(p)
                appsrc = gst2.get_by_name('appsrc')
                vs = gst2.get_by_name('videoscale')
                g2 = gen2()

                buffer = sample.get_buffer()
                appsrc.emit("push-buffer", buffer)
                s2 = await g2.__anext__()
                print(time.time())
                await g2.aclose()

            i = i + 1
            if i == 10:
                break

    loop = asyncio.new_event_loop()
    asyncio.ensure_future(asyncMain(), loop = loop)
    loop.run_forever()

if __name__ == "__main__":
    test = 334
    foo = f"{test}"
    threading.Thread(target = mainThread).start()
    mainLoop = GLib.MainLoop()
    mainLoop.run()
