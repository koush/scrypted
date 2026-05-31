import scrypted_sdk
from typing import List


def createZygote():
    queue: List[scrypted_sdk.PluginFork] = []
    for i in range(0, 4):
        queue.append(scrypted_sdk.fork())

    def next():
        while True:
            cur = queue.pop(0)
            queue.append(scrypted_sdk.fork())
            yield cur

    gen = next()
    return lambda: gen.__next__()
