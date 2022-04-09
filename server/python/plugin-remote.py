from __future__ import annotations

import asyncio
import base64
import gc
import json
import os
import platform
import resource
import shutil
import subprocess
import threading
import time
import zipfile
from asyncio.events import AbstractEventLoop
from asyncio.futures import Future
from asyncio.streams import StreamReader, StreamWriter
from collections.abc import Mapping
from io import StringIO
from os import sys
from typing import Any, Optional, Set, Tuple

import aiofiles
import gi
import scrypted_python.scrypted_sdk.types
from scrypted_python.scrypted_sdk.types import (Device, DeviceManifest,
                                                MediaManager,
                                                ScryptedInterfaceProperty,
                                                Storage)
from typing_extensions import TypedDict

import rpc

gi.require_version('Gst', '1.0')

from gi.repository import GLib, Gst

Gst.init(None)

class SystemDeviceState(TypedDict):
    lastEventTime: int
    stateTime: int
    value: any


class SystemManager(scrypted_python.scrypted_sdk.types.SystemManager):
    def __init__(self, api: Any, systemState: Mapping[str, Mapping[str, SystemDeviceState]]) -> None:
        super().__init__()
        self.api = api
        self.systemState = systemState
    
    async def getComponent(self, id: str) -> Any:
        return await self.api.getComponent(id)

class DeviceState(scrypted_python.scrypted_sdk.types.DeviceState):
    def __init__(self, id: str, nativeId: str, systemManager: SystemManager, deviceManager: scrypted_python.scrypted_sdk.types.DeviceManager) -> None:
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


class DeviceStorage(Storage):
    id: str
    nativeId: str
    storage: Mapping[str, str]
    remote: PluginRemote
    loop: AbstractEventLoop

    def update_storage(self):
        self.remote.api.setStorage(self.nativeId, self.storage)

    def getItem(self, key: str) -> str:
        return self.storage.get(key, None)

    def setItem(self, key: str, value: str):
        self.storage[key] = value
        self.update_storage()

    def removeItem(self, key: str):
        self.storage.pop(key, None)
        self.update_storage()

    def getKeys(self) -> Set[str]:
        return self.storage.keys()

    def clear(self):
        self.storage = {}
        self.update_storage()

class DeviceManager(scrypted_python.scrypted_sdk.types.DeviceManager):
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

    async def onDeviceDiscovered(self, devices: Device) -> str:
        return await self.systemManager.api.onDeviceDiscovered(devices)

    async def onDeviceRemoved(self, nativeId: str) -> None:
        return await self.systemManager.api.onDeviceRemoved(nativeId)

    async def onMixinEvent(self, id: str, mixinDevice: Any, eventInterface: str, eventData: Any) -> None:
        return await self.systemManager.api.onMixinEvent(id, mixinDevice, eventInterface, eventData)

    async def requestRestart(self) -> None:
        return await self.systemManager.api.onMixinEvent(id)

    def getDeviceStorage(self, nativeId: str = None) -> Storage:
        return self.nativeIds.get(nativeId, None)

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
        zipPath: str

        if isinstance(zipData, str):
            zipPath = (options and options.get('filename', None)) or zipData
            if zipPath != zipData:
                shutil.copyfile(zipData, zipPath)
        else:
            zipPath = options['filename']
            f = open(zipPath, 'wb')
            f.write(zipData)
            f.close()

        zipData = None

        zip = zipfile.ZipFile(zipPath)

        plugin_volume = os.environ.get('SCRYPTED_PLUGIN_VOLUME')
        python_prefix = os.path.join(plugin_volume, 'python-%s-%s' % (platform.system(), platform.machine()))
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
                python_prefix, 'requirements.installed.txt')

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
        return await rpc.maybe_await(create_scrypted_plugin())

    async def setSystemState(self, state):
        self.systemState = state

    async def setNativeId(self, nativeId, id, storage):
        if id:
            ds = DeviceStorage()
            ds.id = id
            ds.nativeId = nativeId
            ds.storage = storage
            ds.remote = self
            ds.loop = self.loop
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
            sys.exit()


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

    def oob_runner():
        ptime = round(time.process_time() * 1000000)
        heapTotal = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        oob = {
            'type': 'stats',
            'cpuUsage': {
                'user': ptime,
                'system': 0,
            },
            'memoryUsage': {
                'heapTotal': heapTotal,
            },
        }
        peer.sendOob(oob)
        loop.call_later(10, oob_runner)
    oob_runner()

    await readLoop(loop, peer, reader)


def main():
    loop = asyncio.new_event_loop()

    def gc_runner():
        gc.collect()
        loop.call_later(10, gc_runner)
    gc_runner()

    loop.run_until_complete(async_main(loop))
    loop.close()


if __name__ == "__main__":
    worker = threading.Thread(target=main)
    worker.start()

    loop = GLib.MainLoop()
    loop.run()
