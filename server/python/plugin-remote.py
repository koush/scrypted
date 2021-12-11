from __future__ import annotations
from typing import Optional
from io import StringIO
from typing import Any
import subprocess
import zipfile
import time
import base64
from typing_extensions import TypedDict
from typing import Tuple
import aiofiles
import json
from asyncio.events import AbstractEventLoop
import asyncio
import rpc
from genericpath import exists
from collections.abc import Mapping
from scrypted_python.scrypted_sdk.types import DeviceManifest, MediaManager, MediaObject, ScryptedInterfaceProperty
import scrypted_python.scrypted_sdk
from asyncio.futures import Future
from asyncio.streams import StreamReader, StreamWriter
import os
from os import sys
from sys import stderr, stdout

class SystemDeviceState(TypedDict):
    lastEventTime: int
    stateTime: int
    value: any


class SystemManager(scrypted_python.scrypted_sdk.SystemManager):
    def __init__(self, api: Any, systemState: Mapping[str, Mapping[str, SystemDeviceState]]) -> None:
        super().__init__()
        self.api = api
        self.systemState = systemState
    
    async def getComponent(self, id: str) -> Any:
        return await self.api.getComponent(id)

class DeviceState(scrypted_python.scrypted_sdk.DeviceState):
    def __init__(self, id: str, nativeId: str, systemManager: SystemManager, deviceManager: scrypted_python.scrypted_sdk.DeviceManager) -> None:
        super().__init__()
        self._id = id
        self.nativeId = nativeId
        self.deviceManager = deviceManager
        self.systemManager = systemManager

    def getScryptedProperty(self, property: str) -> Any:
        deviceState = getattr(
            self.systemManager.systemState, self.nativeId, None)
        if not deviceState:
            print("missing nativeId id %s" % self.nativeId)
            return None
        return getattr(deviceState, property, None)

    def setScryptedProperty(self, property: str, value: Any):
        if property == ScryptedInterfaceProperty.id.value:
            raise Exception("id is read only")
        if property == ScryptedInterfaceProperty.mixins.value:
            raise Exception("mixins is read only")
        if property == ScryptedInterfaceProperty.interfaces.value:
            raise Exception(
                "interfaces is a read only post-mixin computed property, use providedInterfaces")

        now = int(time.time() * 1000)
        self.systemManager.systemState[self._id][property] = {
            "lastEventTime": now,
            "stateTime": now,
            "value": value
        }

        self.systemManager.api.setState(self.nativeId, property, value)


class DeviceStorage:
    id: str
    nativeId: str
    storage: Mapping[str, str] = {}


class DeviceManager(scrypted_python.scrypted_sdk.DeviceManager):
    def __init__(self, nativeIds: Mapping[str, DeviceStorage], systemManager: SystemManager) -> None:
        super().__init__()
        self.nativeIds = nativeIds
        self.systemManager = systemManager

    def getDeviceState(self, nativeId: str) -> DeviceState:
        id = self.nativeIds[nativeId].id
        return DeviceState(id, nativeId, self.systemManager, self)

    async def onDeviceEvent(self, nativeId: str, eventInterface: str, eventData: Any = None) -> None:
        await self.systemManager.api.onDeviceEvent(nativeId, eventInterface, eventData)

    async def onDevicesChanged(self, devices: DeviceManifest) -> None:
        return await self.systemManager.api.onDevicesChanged(devices)


class BufferSerializer(rpc.RpcSerializer):
    def serialize(self, value):
        return base64.b64encode(value).decode('utf8')

    def deserialize(self, value):
        return base64.b64decode(value)


class PluginRemote:
    systemState: Mapping[str, Mapping[str, SystemDeviceState]] = {}
    nativeIds: Mapping[str, DeviceStorage] = {}
    pluginId: str
    mediaManager: MediaManager
    loop: AbstractEventLoop
    consoles: Mapping[str, Future[Tuple[StreamReader, StreamWriter]]] = {}

    def __init__(self, api, pluginId, loop: AbstractEventLoop):
        self.api = api
        self.pluginId = pluginId
        self.loop = loop
        self.__dict__['__proxy_oneway_methods'] = [
            'notify',
            'updateDeviceState',
            'setSystemState',
            'ioEvent',
            'setNativeId',
        ]

    async def print_async(self, nativeId: str, *values: object, sep: Optional[str] = ' ',
                          end: Optional[str] = '\n',
                          flush: bool = False,):
        consoleFuture = self.consoles.get(nativeId)
        if not consoleFuture:
            consoleFuture = Future()
            self.consoles[nativeId] = consoleFuture
            plugins = await self.api.getComponent('plugins')
            port = await plugins.getRemoteServicePort(self.pluginId, 'console-writer')
            connection = await asyncio.open_connection(port=port)
            _, writer = connection
            if not nativeId:
                nid = 'undefined'
            else:
                nid = nativeId
            nid += '\n'
            writer.write(nid.encode('utf8'))
            consoleFuture.set_result(connection)
        _, writer = await consoleFuture
        strio = StringIO()
        print(*values, sep=sep, end=end, flush=flush, file=strio)
        strio.seek(0)
        b = strio.read().encode('utf8')
        writer.write(b)

    def print(self, nativeId: str, *values: object, sep: Optional[str] = ' ',
              end: Optional[str] = '\n',
              flush: bool = False,):
        asyncio.run_coroutine_threadsafe(self.print_async(
            nativeId, *values, sep=sep, end=end, flush=flush), self.loop)

    async def loadZip(self, packageJson, zipData, options=None):
        zipPath = options['filename']

        f = open(zipPath, 'wb')
        f.write(zipData)
        f.close()

        zip = zipfile.ZipFile(zipPath)

        python_prefix = os.path.join(os.environ.get(
            'SCRYPTED_PLUGIN_VOLUME'), 'python')
        if not os.path.exists(python_prefix):
            os.makedirs(python_prefix)

        python = 'python%s' % str(
            sys.version_info[0])+"."+str(sys.version_info[1])
        print('python:', python)

        if 'requirements.txt' in zip.namelist():
            requirements = zip.open('requirements.txt').read()
            str_requirements = requirements.decode('utf8')

            requirementstxt = os.path.join(python_prefix, 'requirements.txt')
            installed_requirementstxt = os.path.join(
                python_prefix, 'installed-requirements.txt')

            need_pip = True
            try:
                existing = open(installed_requirementstxt).read()
                need_pip = existing != str_requirements
            except:
                pass

            if need_pip:
                print('requirements.txt (outdated)')
                print(str_requirements)

                f = open(requirementstxt, 'wb')
                f.write(requirements)
                f.close()

                p = subprocess.Popen([python, '-m', 'pip', 'install', '-r', requirementstxt,
                                     '--prefix', python_prefix], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                while True:
                    line = p.stdout.readline()
                    if not line:
                        break
                    line = line.decode('utf8').rstrip('\r\n')
                    print(line)
                result = p.wait()
                print('pip install result %s' % result)
                if result:
                    raise Exception('non-zero result from pip %s' % result)

                f = open(installed_requirementstxt, 'wb')
                f.write(requirements)
                f.close()
            else:
                print('requirements.txt (up to date)')
                print(str_requirements)

        sys.path.insert(0, zipPath)
        site_packages = os.path.join(
            python_prefix, 'lib/%s/site-packages' % python)
        sys.path.insert(0, site_packages)
        from scrypted_sdk import sdk_init  # type: ignore
        self.systemManager = SystemManager(self.api, self.systemState)
        self.deviceManager = DeviceManager(self.nativeIds, self.systemManager)
        self.mediaManager = await self.api.getMediaManager()
        sdk_init(zip, self, self.systemManager,
                 self.deviceManager, self.mediaManager)
        from main import create_scrypted_plugin  # type: ignore
        return create_scrypted_plugin()

    async def setSystemState(self, state):
        self.systemState = state

    async def setNativeId(self, nativeId, id, storage):
        if id:
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


async def readLoop(loop, peer, reader):
    async for line in reader:
        try:
            message = json.loads(line)
            asyncio.run_coroutine_threadsafe(peer.handleMessage(message), loop)
        except Exception as e:
            print('read loop error', e)
            pass


async def async_main(loop: AbstractEventLoop):
    reader = await aiofiles.open(3, mode='r')

    def send(message, reject=None):
        jsonString = json.dumps(message)
        try:
            os.write(4, bytes(jsonString + '\n', 'utf8'))
        except Exception as e:
            if reject:
                reject(e)

    peer = rpc.RpcPeer(send)
    peer.nameDeserializerMap['Buffer'] = BufferSerializer()
    peer.constructorSerializerMap[bytes] = 'Buffer'
    peer.constructorSerializerMap[bytearray] = 'Buffer'
    peer.params['print'] = print
    peer.params['getRemote'] = lambda api, pluginId: PluginRemote(
        api, pluginId, loop)

    await readLoop(loop, peer, reader)


def main():
    loop = asyncio.get_event_loop()
    loop.run_until_complete(async_main(loop))
    loop.close()


if __name__ == "__main__":
    main()
