import asyncio
import rpc
from rpc_reader import prepare_peer_readloop, RpcFileTransport
import traceback


class Bar:
    pass


async def main():
    peer, peerReadLoop = await prepare_peer_readloop(loop, RpcFileTransport(4, 3))
    peer.params["foo"] = 3
    jsoncopy = {}
    jsoncopy[rpc.RpcPeer.PROPERTY_JSON_COPY_SERIALIZE_CHILDREN] = True
    jsoncopy["bar"] = Bar()
    peer.params["bar"] = jsoncopy

    # reader, writer = await asyncio.open_connection(
    #     '127.0.0.1', 6666)

    # writer.write(bytes('abcd', 'utf8'))

    # async def ticker(delay, to):
    #     for i in range(to):
    #         # print(i)
    #         yield i
    #         await asyncio.sleep(delay)

    # peer.params['ticker'] = ticker(0, 3)

    print("python starting")
    # await peerReadLoop()
    asyncio.ensure_future(peerReadLoop())

    # print('getting param')
    test = await peer.getParam("test")
    print(test)
    try:
        i = 0
        async for c in await test():
            print(c)
            if i == 5:
                break
            i = i + 1
    except:
        traceback.print_exc()
    print("all done iterating")


loop = asyncio.new_event_loop()
loop.run_until_complete(main())
