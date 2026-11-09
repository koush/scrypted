# Regression test: a proxy collected by the cyclic GC while send() holds the transport's
# write lock must not re-enter send() (which deadlocked the event loop thread), and its
# finalize message must still reach the remote. Run with: python3 rpc-finalize-test.py
import asyncio
import gc
import threading

import rpc_reader


class RecordingTransport(rpc_reader.RpcTransport):
    def __init__(self):
        super().__init__()
        self.sent = []
        self.collectOnNextWrite = False

    async def prepare(self):
        pass

    def writeBuffer(self, buffer, reject):
        pass

    def writeSerialized(self, j, reject):
        if self.collectOnNextWrite:
            self.collectOnNextWrite = False
            # Stand-in for the GC kicking in on an allocation inside json.dumps.
            gc.collect()
        self.sent.append(j)


def dropInCycle(proxy):
    holder = {"proxy": proxy}
    holder["self"] = holder


async def main():
    transport = RecordingTransport()
    peer, _ = await rpc_reader.prepare_peer_readloop(
        asyncio.get_running_loop(), transport
    )

    dropInCycle(peer.newProxy("p1", "Image", None, None))
    transport.collectOnNextWrite = True
    done = threading.Event()

    def sendFromThread():
        peer.send({"type": "apply"})
        done.set()

    threading.Thread(target=sendFromThread, daemon=True).start()
    await asyncio.get_running_loop().run_in_executor(None, done.wait, 3)
    assert done.is_set(), "send() deadlocked while the GC finalized a proxy"

    # The finalize is deferred to the loop, so let it run.
    await asyncio.sleep(0)
    finalizes = [m for m in transport.sent if m.get("type") == "finalize"]
    assert [m["__local_proxy_id"] for m in finalizes] == ["p1"], transport.sent

    # A proxy re-sent under the same id before the deferred finalize runs must survive it.
    dropInCycle(peer.newProxy("p2", "Image", None, None))
    gc.collect()
    replacement = peer.newProxy("p2", "Image", None, None)
    await asyncio.sleep(0)
    assert peer.remoteWeakProxies["p2"]() is replacement

    print("ok")


gc.disable()  # collect only where the test says so
asyncio.run(main())
