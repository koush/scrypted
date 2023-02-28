from __future__ import annotations

import asyncio
import base64
import gc
import json
import sys
import os
import platform
import shutil
import subprocess
import threading
import time
import traceback
import zipfile
from asyncio.events import AbstractEventLoop
from asyncio.futures import Future
from asyncio.streams import StreamReader, StreamWriter
from collections.abc import Mapping
from io import StringIO
from os import sys
from typing import Any, List, Optional, Set, Tuple

import aiofiles
import scrypted_python.scrypted_sdk.types
from scrypted_python.scrypted_sdk import ScryptedStatic, PluginFork
from scrypted_python.scrypted_sdk.types import Device, DeviceManifest, EventDetails, ScryptedInterfaceProperty, Storage
from typing_extensions import TypedDict
import rpc
import rpc_reader
import multiprocessing
import multiprocessing.connection

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


class MediaObject(scrypted_python.scrypted_sdk.types.MediaObject):
    def __init__(self, data, mimeType, sourceId):
        self.mimeType = mimeType
        self.data = data
        setattr(self, '__proxy_props', {
            'mimeType': mimeType,
            'sourceId': sourceId,
        })

    async def getData(self):
        return self.data


class MediaManager:
    def __init__(self, mediaManager: scrypted_python.scrypted_sdk.types.MediaManager):
        self.mediaManager = mediaManager

    async def addConverter(self, converter: scrypted_python.scrypted_sdk.types.BufferConverter) -> None:
        return await self.mediaManager.addConverter(converter)

    async def clearConverters(self) -> None:
        return await self.mediaManager.clearConverters()

    async def convertMediaObject(self, mediaObject: scrypted_python.scrypted_sdk.types.MediaObject, toMimeType: str) -> Any:
        return await self.mediaManager.convertMediaObject(mediaObject, toMimeType)

    async def convertMediaObjectToBuffer(self, mediaObject: scrypted_python.scrypted_sdk.types.MediaObject, toMimeType: str) -> bytearray:
        return await self.mediaManager.convertMediaObjectToBuffer(mediaObject, toMimeType)

    async def convertMediaObjectToInsecureLocalUrl(self, mediaObject: str | scrypted_python.scrypted_sdk.types.MediaObject, toMimeType: str) -> str:
        return await self.mediaManager.convertMediaObjectToInsecureLocalUrl(mediaObject, toMimeType)

    async def convertMediaObjectToJSON(self, mediaObject: scrypted_python.scrypted_sdk.types.MediaObject, toMimeType: str) -> Any:
        return await self.mediaManager.convertMediaObjectToJSON(mediaObject, toMimeType)

    async def convertMediaObjectToLocalUrl(self, mediaObject: str | scrypted_python.scrypted_sdk.types.MediaObject, toMimeType: str) -> str:
        return await self.mediaManager.convertMediaObjectToLocalUrl(mediaObject, toMimeType)

    async def convertMediaObjectToUrl(self, mediaObject: str | scrypted_python.scrypted_sdk.types.MediaObject, toMimeType: str) -> str:
        return await self.mediaManager.convertMediaObjectToUrl(mediaObject, toMimeType)

    async def createFFmpegMediaObject(self, ffmpegInput: scrypted_python.scrypted_sdk.types.FFmpegInput, options: scrypted_python.scrypted_sdk.types.MediaObjectOptions = None) -> scrypted_python.scrypted_sdk.types.MediaObject:
        return await self.mediaManager.createFFmpegMediaObject(ffmpegInput, options)

    async def createMediaObject(self, data: Any, mimeType: str, options: scrypted_python.scrypted_sdk.types.MediaObjectOptions = None) -> scrypted_python.scrypted_sdk.types.MediaObject:
        # return await self.createMediaObject(data, mimetypes, options)
        return MediaObject(data, mimeType, options.get('sourceId', None) if options else None)

    async def createMediaObjectFromUrl(self, data: str, options: scrypted_python.scrypted_sdk.types. MediaObjectOptions = None) -> scrypted_python.scrypted_sdk.types.MediaObject:
        return await self.mediaManager.createMediaObjectFromUrl(data, options)

    async def getFFmpegPath(self) -> str:
        return await self.mediaManager.getFFmpegPath()

    async def getFilesPath(self) -> str:
        return await self.mediaManager.getFilesPath()


class DeviceState(scrypted_python.scrypted_sdk.types.DeviceState):
    def __init__(self, id: str, nativeId: str, systemManager: SystemManager, deviceManager: scrypted_python.scrypted_sdk.types.DeviceManager) -> None:
        super().__init__()
        self._id = id
        self.nativeId = nativeId
        self.deviceManager = deviceManager
        self.systemManager = systemManager

    def getScryptedProperty(self, property: str) -> Any:
        if property == ScryptedInterfaceProperty.id.value:
            return self._id
        deviceState = self.systemManager.systemState.get(self._id, None)
        if not deviceState:
            print("missing id %s" % self._id)
            return None
        sdd = deviceState.get(property, None)
        if not sdd:
            return None
        return sdd.get('value', None)

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
        return await self.systemManager.api.requestRestart()

    def getDeviceStorage(self, nativeId: str = None) -> Storage:
        return self.nativeIds.get(nativeId, None)


class BufferSerializer(rpc.RpcSerializer):
    def serialize(self, value, serializationContext):
        return base64.b64encode(value).decode('utf8')

    def deserialize(self, value, serializationContext):
        return base64.b64decode(value)


class SidebandBufferSerializer(rpc.RpcSerializer):
    def serialize(self, value, serializationContext):
        buffers = serializationContext.get('buffers', None)
        if not buffers:
            buffers = []
            serializationContext['buffers'] = buffers
        buffers.append(value)
        return len(buffers) - 1

    def deserialize(self, value, serializationContext):
        buffers: List = serializationContext.get('buffers', None)
        buffer = buffers.pop()
        return buffer


class PluginRemote:
    systemState: Mapping[str, Mapping[str, SystemDeviceState]] = {}
    nativeIds: Mapping[str, DeviceStorage] = {}
    pluginId: str
    hostInfo: Any
    mediaManager: MediaManager
    loop: AbstractEventLoop
    consoles: Mapping[str, Future[Tuple[StreamReader, StreamWriter]]] = {}

    def __init__(self, api, pluginId, hostInfo, loop: AbstractEventLoop):
        self.api = api
        self.pluginId = pluginId
        self.hostInfo = hostInfo
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

    async def loadZip(self, packageJson, zipData, options: dict=None):
        forkMain = options and options.get('fork')

        if not forkMain:
            multiprocessing.set_start_method('spawn')

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

            python_version = 'python%s' % str(
                sys.version_info[0])+"."+str(sys.version_info[1])
            print('python version:', python_version)

            python_prefix = os.path.join(
                plugin_volume, '%s-%s-%s' % (python_version, platform.system(), platform.machine()))
            if not os.path.exists(python_prefix):
                os.makedirs(python_prefix)

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

                    p = subprocess.Popen([sys.executable, '-m', 'pip', 'install', '-r', requirementstxt,
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
            if platform.system() != 'Windows':
                site_packages = os.path.join(
                    python_prefix, 'lib', python_version, 'site-packages')
            else:
                site_packages = os.path.join(
                    python_prefix, 'Lib', 'site-packages')
            print('site-packages: %s' % site_packages)
            sys.path.insert(0, site_packages)
        else:
            zip = zipfile.ZipFile(options['filename'])

        self.systemManager = SystemManager(self.api, self.systemState)
        self.deviceManager = DeviceManager(self.nativeIds, self.systemManager)
        self.mediaManager = MediaManager(await self.api.getMediaManager())

        try:
            from scrypted_sdk import sdk_init2  # type: ignore

            sdk = ScryptedStatic()
            sdk.systemManager = self.systemManager
            sdk.deviceManager = self.deviceManager
            sdk.mediaManager = self.mediaManager
            sdk.remote = self
            sdk.api = self.api
            sdk.zip = zip

            def host_fork() -> PluginFork:
                parent_conn, child_conn = multiprocessing.Pipe()
                pluginFork = PluginFork()
                pluginFork.worker = multiprocessing.Process(target=plugin_fork, args=(child_conn,), daemon=True)
                pluginFork.worker.start()
                async def getFork():
                    fd = os.dup(parent_conn.fileno())
                    peer, readLoop = await rpc_reader.prepare_peer_readloop(self.loop, fd, fd)
                    peer.peerName = 'thread'
                    asyncio.run_coroutine_threadsafe(readLoop(), loop=self.loop)
                    getRemote = await peer.getParam('getRemote')
                    remote: PluginRemote = await getRemote(self.api, self.pluginId, self.hostInfo)
                    await remote.setSystemState(self.systemManager.getSystemState())
                    for nativeId, ds in self.nativeIds.items():
                        await remote.setNativeId(nativeId, ds.id, ds.storage)
                    forkOptions = (options or {}).copy()
                    forkOptions['fork'] = True
                    forkOptions['filename'] = zipPath
                    return await remote.loadZip(packageJson, zipData, forkOptions)
                    

                pluginFork.result = asyncio.create_task(getFork())
                return pluginFork

            sdk.fork = host_fork

            sdk_init2(sdk)
        except:
            from scrypted_sdk import sdk_init  # type: ignore
            sdk_init(zip, self, self.systemManager,
                     self.deviceManager, self.mediaManager)

        if not forkMain:
            try:
                from main import create_scrypted_plugin  # type: ignore
            except:
                print('plugin failed to start')
                traceback.print_exc()
                raise
            return await rpc.maybe_await(create_scrypted_plugin())

        try:
            from main import fork  # type: ignore
        except:
            print('fork failed to start')
            traceback.print_exc()
            raise
        return await rpc.maybe_await(fork())

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

    async def notify(self, id, eventDetails: EventDetails, value):
        property = eventDetails.get('property')
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

async def plugin_async_main(loop: AbstractEventLoop, readFd: int, writeFd: int):
    peer, readLoop = await rpc_reader.prepare_peer_readloop(loop, readFd, writeFd)
    peer.params['print'] = print
    peer.params['getRemote'] = lambda api, pluginId, hostInfo: PluginRemote(
        api, pluginId, hostInfo, loop)

    async def get_update_stats():
        update_stats = await peer.getParam('updateStats')

        def stats_runner():
            ptime = round(time.process_time() * 1000000)
            try:
                import psutil
                process = psutil.Process(os.getpid())
                heapTotal = process.memory_info().rss
            except:
                try:
                    import resource
                    heapTotal = resource.getrusage(
                        resource.RUSAGE_SELF).ru_maxrss
                except:
                    heapTotal = 0
            stats = {
                'type': 'stats',
                'cpu': {
                    'user': ptime,
                    'system': 0,
                },
                'memoryUsage': {
                    'heapTotal': heapTotal,
                },
            }
            asyncio.run_coroutine_threadsafe(update_stats(stats), loop)
            loop.call_later(10, stats_runner)

        stats_runner()

    asyncio.run_coroutine_threadsafe(get_update_stats(), loop)

    await readLoop()


def main(readFd: int, writeFd: int):
    loop = asyncio.new_event_loop()

    def gc_runner():
        gc.collect()
        loop.call_later(10, gc_runner)
    gc_runner()

    loop.run_until_complete(plugin_async_main(loop, readFd, writeFd))
    loop.close()

print('running')

def plugin_main(readFd: int, writeFd: int):
    try:
        import gi
        gi.require_version('Gst', '1.0')
        from gi.repository import GLib, Gst
        Gst.init(None)

        worker = threading.Thread(target=main, args=(readFd, writeFd))
        worker.start()

        loop = GLib.MainLoop()
        loop.run()
    except:
        main(readFd, writeFd)


def plugin_fork(conn: multiprocessing.connection.Connection):
    fd = os.dup(conn.fileno())
    plugin_main(fd, fd)

if __name__ == "__main__":
    plugin_main(3, 4)
