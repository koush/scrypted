import sys
import asyncio
from  rpc_reader import prepare_peer_readloop

async def main():
    peer, peerReadLoop = await prepare_peer_readloop(loop, 4, 3)
    peer.params['foo'] = 3

    async def ticker(delay, to):
        for i in range(to):
            # print(i)
            yield i
            await asyncio.sleep(delay)

    peer.params['ticker'] = ticker(0, 3)

    print('python starting')
    await peerReadLoop()

loop = asyncio.new_event_loop()
loop.run_until_complete(main())
