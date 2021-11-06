from collections.abc import Mapping
from rpc import RpcPeer, readLoop, RpcSerializer
import asyncio
from asyncio.events import AbstractEventLoop
import json
import aiofiles
import os
from typing import TypedDict
import base64
from os import sys
import zipfile
import subprocess

class BufferSerializer(RpcSerializer):
    def serialize(self, value):
        return base64.b64encode(value)

    def deserialize(self, value):
        return base64.b64decode(value)


class SystemDeviceState(TypedDict):
    lastEventTime: int
    stateTime: int
    value: any


class DeviceStorage:
    id: str
    nativeId: str
    storage: Mapping[str, str] = {}


class PluginRemote:
    systemState: Mapping[str, Mapping[str, SystemDeviceState]] = {}
    nativeIds: Mapping[str, DeviceStorage] = {}
    pluginId: str

    def __init__(self, api, pluginId):
        self.api = api
        self.pluginId = pluginId

    async def loadZip(self, packageJson, zipData, options=None):
        zipPath = options['filename']

        f = open(zipPath, 'wb')
        f.write(zipData)
        f.close()

        zip = zipfile.ZipFile(zipPath)
        requirements = zip.open('requirements.txt').read()

        python_modules = os.path.join(os.environ.get('SCRYPTED_PLUGIN_VOLUME'), 'python', 'modules')
        if not os.path.exists(python_modules):
            os.makedirs(python_modules)
        requirementstxt = os.path.join(python_modules, 'requirements.txt')

        f = open(requirementstxt, 'wb')
        f.write(requirements)
        f.close()

        # os.system('pip install -r %s --target %s' % (requirementstxt, python_modules))
        result = subprocess.check_output(['pip', 'install', '-r', requirementstxt, '--target', python_modules], stderr=subprocess.STDOUT, text=True)
        print(result)

        sys.path.insert(0, zipPath)
        sys.path.insert(0, python_modules)
        from main import plugin_main
        plugin_main()

    async def setSystemState(self, state):
        self.systemState = state

    async def setNativeId(self, nativeId, id, storage):
        if nativeId:
            ds = DeviceStorage()
            ds.id = id
            ds.storage = storage
            self.nativeIds[nativeId] = ds
        else:
            self.nativeIds.pop(nativeId, None)

    async def updateDeviceState(self, id, state):
        if not state:
            self.systemState.pop(id, None)
        else:
            self.systemState[id] = state

    async def notify(self, id, eventTime, eventInterface, property, value, changed=False):
        if property:
            state = None
            if self.systemState:
                state = self.systemState.get(id, None)
                if not state:
                    print('state not found for %s' % id)
                    return
                state[property] = value
                # systemManager.events.notify(id, eventTime, eventInterface, property, value.value, changed);
        else:
            # systemManager.events.notify(id, eventTime, eventInterface, property, value, changed);
            pass

    async def ioEvent(self, id, event, message=None):
        pass

    async def createDeviceState(self, id, setState):
        pass

    async def getServicePort(self, name):
        pass


async def async_main(loop: AbstractEventLoop):
    reader = await aiofiles.open(3, mode='r')
    # writer = open(4, 'r+')

    def send(message, reject=None):
        jsonString = json.dumps(message)
        try:
            os.write(4, bytes(jsonString + '\n', 'utf8'))
        except Exception as e:
            if reject:
                reject(e)

    peer = RpcPeer(send)
    peer.nameDeserializerMap['Buffer'] = BufferSerializer()
    peer.params['print'] = print
    peer.params['getRemote'] = lambda api, pluginId: PluginRemote(
        api, pluginId)

    async def consoleTest():
        console = await peer.getParam('console')
        # await console.log('test', 'poops', 'peddeps')

    await asyncio.gather(readLoop(loop, peer, reader), consoleTest())
    print('done')

    # print("line %s" % line)


def main():
    loop = asyncio.get_event_loop()
    loop.run_until_complete(async_main(loop))
    loop.close()


if __name__ == "__main__":
    main()
