from __future__ import annotations

import asyncio
import gc
import os
import platform
import shutil
import subprocess
import sys
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
from typing import Any, Optional, Set, Tuple

import scrypted_python.scrypted_sdk.types
from scrypted_python.scrypted_sdk import PluginFork, ScryptedStatic
from scrypted_python.scrypted_sdk.types import (Device, DeviceManifest,
                                                EventDetails,
                                                ScryptedInterfaceMethods,
                                                ScryptedInterfaceProperty,
                                                Storage)

try:
    from typing import TypedDict
except:
    from typing_extensions import TypedDict

import hashlib
import multiprocessing
import multiprocessing.connection

import rpc
import rpc_reader


class SystemDeviceState(TypedDict):
    lastEventTime: int
    stateTime: int
    value: any


class DeviceProxy(object):
    device: asyncio.Future[rpc.RpcPeer]

    def __init__(self, systemManager: SystemManager, id: str):
        self.systemManager = systemManager
        self.id = id
        self.device = None

    def __getattr__(self, name):
        if name == 'id':
            return self.id

        if hasattr(ScryptedInterfaceProperty, name):
            state = self.systemManager.systemState.get(self.id)
            if not state:
                return
            p = state.get(name)
            if not p:
                return
            return p.get('value', None)
        if hasattr(ScryptedInterfaceMethods, name):
            return rpc.RpcProxyMethod(self, name)

    def __setattr__(self, name: str, value: Any) -> None:
        if name == '__proxy_finalizer_id':
            self.__dict__['__proxy_entry']['finalizerId'] = value

        return super().__setattr__(name, value)

    def __apply__(self, method: str, args: list):
        if not self.device:
            self.device = self.systemManager.api.getDeviceById(self.id)

        async def apply():
            device = await self.device
            return await device.__apply__(method, args)
        return apply()


class SystemManager(scrypted_python.scrypted_sdk.types.SystemManager):
    deviceProxies: Mapping[str, DeviceProxy]

    def __init__(self, api: Any, systemState: Mapping[str, Mapping[str, SystemDeviceState]]) -> None:
        super().__init__()
        self.api = api
        self.systemState = systemState
        self.deviceProxies = {}

    async def getComponent(self, id: str) -> Any:
        return await self.api.getComponent(id)

    def getSystemState(self) -> Any:
        return self.systemState

    def getDeviceById(self, idOrPluginId: str, nativeId: str = None) -> scrypted_python.scrypted_sdk.ScryptedDevice:
        id: str = None
        if self.systemState.get(idOrPluginId, None):
            if nativeId is not None:
                return
            id = idOrPluginId
        else:
            for check in self.systemState:
                state = self.systemState.get(check, None)
                if not state:
                    continue
                pluginId = state.get('pluginId', None)
                if not pluginId:
                    continue
                pluginId = pluginId.get('value', None)
                if pluginId == idOrPluginId:
                    checkNativeId = state.get('nativeId', None)
                    if not checkNativeId:
                        continue
                    checkNativeId = checkNativeId.get('value', None)
                    if nativeId == checkNativeId:
                        id = idOrPluginId
                        break

        if not id:
            return
        ret = self.deviceProxies.get(id)
        if not ret:
            ret = DeviceProxy(self, id)
            self.deviceProxies[id] = ret
        return ret

    def getDeviceByName(self, name: str) -> scrypted_python.scrypted_sdk.ScryptedDevice:
        for check in self.systemState:
            state = self.systemState.get(check, None)
            if not state:
                continue
            checkName = state.get('name', None)
            if not checkName:
                continue
            if checkName.get('value', None) == name:
                return self.getDeviceById(check)

    # TODO
    async def listen(self, callback: scrypted_python.scrypted_sdk.EventListener) -> scrypted_python.scrypted_sdk.EventListenerRegister:
        return super().listen(callback)

    # TODO
    async def listenDevice(self, id: str, event: str | scrypted_python.scrypted_sdk.EventListenerOptions, callback: scrypted_python.scrypted_sdk.EventListener) -> scrypted_python.scrypted_sdk.EventListenerRegister:
        return super().listenDevice(id, event, callback)

    async def removeDevice(self, id: str) -> None:
        return await self.api.removeDevice(id)


class MediaObject(scrypted_python.scrypted_sdk.types.MediaObject):
    def __init__(self, data, mimeType, options):
        self.data = data

        proxyProps = {}
        setattr(self, rpc.RpcPeer.PROPERTY_PROXY_PROPERTIES, proxyProps)

        options = options or {}
        options['mimeType'] = mimeType

        for key, value in options.items():
            if rpc.RpcPeer.isTransportSafe(value):
                proxyProps[key] = value
            setattr(self, key, value)

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
        return MediaObject(data, mimeType, options)

    async def createMediaObjectFromUrl(self, data: str, options: scrypted_python.scrypted_sdk.types.MediaObjectOptions = None) -> scrypted_python.scrypted_sdk.types.MediaObject:
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


class PluginRemote:
    systemState: Mapping[str, Mapping[str, SystemDeviceState]] = {}
    nativeIds: Mapping[str, DeviceStorage] = {}
    pluginId: str
    hostInfo: Any
    mediaManager: MediaManager
    loop: AbstractEventLoop
    consoles: Mapping[str, Future[Tuple[StreamReader, StreamWriter]]] = {}
    ptimeSum = 0

    def __init__(self, peer: rpc.RpcPeer, api, pluginId, hostInfo, loop: AbstractEventLoop):
        self.allMemoryStats = {}
        self.peer = peer
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

    async def loadZip(self, packageJson, zipData, options: dict = None):
        try:
            return await self.loadZipWrapped(packageJson, zipData, options)
        except:
            print('plugin start/fork failed')
            traceback.print_exc()
            raise

    async def loadZipWrapped(self, packageJson, zipData, options: dict = None):
        sdk = ScryptedStatic()

        clusterId = options['clusterId']
        clusterSecret = options['clusterSecret']

        def onProxySerialization(value: Any, proxyId: str, source: int = None):
            properties: dict = rpc.RpcPeer.prepareProxyProperties(value) or {}
            clusterEntry = properties.get('__cluster', None)
            if not properties.get('__cluster', None):
                clusterEntry = {
                    'id': clusterId,
                    'proxyId': proxyId,
                    'port': clusterPort,
                    'source': source,
                }
                properties['__cluster'] = clusterEntry

            # clusterEntry['proxyId'] = proxyId
            # clusterEntry['source'] = source
            return properties

        self.peer.onProxySerialization = onProxySerialization

        async def resolveObject(id: str, sourcePeerPort: int):
            sourcePeer: rpc.RpcPeer = self.peer if not sourcePeerPort else await rpc.maybe_await(clusterPeers.get(sourcePeerPort))
            if not sourcePeer:
                return
            return sourcePeer.localProxyMap.get(id, None)

        clusterPeers: Mapping[int, asyncio.Future[rpc.RpcPeer]] = {}

        async def handleClusterClient(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
            _, clusterPeerPort = writer.get_extra_info('peername')
            rpcTransport = rpc_reader.RpcStreamTransport(reader, writer)
            peer: rpc.RpcPeer
            peer, peerReadLoop = await rpc_reader.prepare_peer_readloop(self.loop, rpcTransport)
            peer.onProxySerialization = lambda value, proxyId: onProxySerialization(
                value, proxyId, clusterPeerPort)
            future: asyncio.Future[rpc.RpcPeer] = asyncio.Future()
            future.set_result(peer)
            clusterPeers[clusterPeerPort] = future

            async def connectRPCObject(id: str, secret: str, sourcePeerPort: int = None):
                m = hashlib.sha256()
                m.update(bytes('%s%s' % (clusterPort, clusterSecret), 'utf8'))
                portSecret = m.hexdigest()
                if secret != portSecret:
                    raise Exception('secret incorrect')
                return await resolveObject(id, sourcePeerPort)

            peer.params['connectRPCObject'] = connectRPCObject
            try:
                await peerReadLoop()
            except:
                pass
            finally:
                clusterPeers.pop(clusterPeerPort)
                peer.kill('cluster client killed')
                writer.close()

        clusterRpcServer = await asyncio.start_server(handleClusterClient, '127.0.0.1', 0)
        clusterPort = clusterRpcServer.sockets[0].getsockname()[1]

        def ensureClusterPeer(port: int):
            clusterPeerPromise = clusterPeers.get(port)
            if not clusterPeerPromise:
                async def connectClusterPeer():
                    reader, writer = await asyncio.open_connection(
                        '127.0.0.1', port)
                    _, clusterPeerPort = writer.get_extra_info('sockname')
                    rpcTransport = rpc_reader.RpcStreamTransport(
                        reader, writer)
                    clusterPeer, peerReadLoop = await rpc_reader.prepare_peer_readloop(self.loop, rpcTransport)
                    clusterPeer.tags['localPort'] = clusterPeerPort
                    clusterPeer.onProxySerialization = lambda value, proxyId: onProxySerialization(
                        value, proxyId, clusterPeerPort)

                    async def run_loop():
                        try:
                            await peerReadLoop()
                        except:
                            pass
                        finally:
                            clusterPeers.pop(port)
                    asyncio.run_coroutine_threadsafe(run_loop(), self.loop)
                    return clusterPeer
                clusterPeerPromise = self.loop.create_task(
                    connectClusterPeer())
                clusterPeers[port] = clusterPeerPromise
            return clusterPeerPromise

        async def connectRPCObject(value):
            clusterObject = getattr(value, '__cluster')
            if type(clusterObject) is not dict:
                return value

            if clusterObject.get('id', None) != clusterId:
                return value

            port = clusterObject['port']
            proxyId = clusterObject['proxyId']
            source = clusterObject.get('source', None)
            if port == clusterPort:
                return await resolveObject(proxyId, source)

            clusterPeerPromise = ensureClusterPeer(port)

            try:
                clusterPeer = await clusterPeerPromise
                if clusterPeer.tags.get('localPort') == source:
                    return value
                c = await clusterPeer.getParam('connectRPCObject')
                m = hashlib.sha256()
                m.update(bytes('%s%s' % (port, clusterSecret), 'utf8'))
                portSecret = m.hexdigest()
                newValue = await c(proxyId, portSecret, source)
                if not newValue:
                    raise Exception('ipc object not found?')
                return newValue
            except Exception as e:
                return value

        sdk.connectRPCObject = connectRPCObject

        forkMain = options and options.get('fork')

        if not forkMain:
            multiprocessing.set_start_method('spawn')

            zipPath: str

            if isinstance(zipData, str):
                zipPath = (options and options.get(
                    'filename', None)) or zipData
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

            # it's possible to run 32bit docker on aarch64, which cause pip requirements
            # to fail because pip only allows filtering on machine, even if running a different architeture.
            # this will cause prebuilt wheel installation to fail.
            if platform.machine() == 'aarch64' and platform.architecture()[0] == '32bit':
                print('=============================================')
                print(
                    'Python machine vs architecture mismatch detected. Plugin installation may fail.')
                print(
                    'This issue occurs if a 32bit system was upgraded to a 64bit kernel.')
                print(
                    'Reverting to the 32bit kernel (or reflashing as native 64 bit is recommended.')
                print('https://github.com/koush/scrypted/issues/678')
                print('=============================================')

            python_version = 'python%s' % str(
                sys.version_info[0])+"."+str(sys.version_info[1])
            print('python version:', python_version)

            python_versioned_directory = '%s-%s-%s' % (
                python_version, platform.system(), platform.machine())
            SCRYPTED_BASE_VERSION = os.environ.get('SCRYPTED_BASE_VERSION')
            if SCRYPTED_BASE_VERSION:
                python_versioned_directory += '-' + SCRYPTED_BASE_VERSION

            python_prefix = os.path.join(
                plugin_volume, python_versioned_directory)

            print('python prefix: %s' % python_prefix)

            if not os.path.exists(python_prefix):
                os.makedirs(python_prefix)

            if 'requirements.txt' in zip.namelist():
                requirements = zip.open('requirements.txt').read()
                str_requirements = requirements.decode('utf8')

                requirementstxt = os.path.join(
                    python_prefix, 'requirements.txt')
                installed_requirementstxt = os.path.join(
                    python_prefix, 'requirements.installed.txt')

                need_pip = True
                try:
                    existing = open(installed_requirementstxt).read()
                    need_pip = existing != str_requirements
                except:
                    pass

                if need_pip:
                    try:
                        for de in os.listdir(plugin_volume):
                            if de.startswith('linux') or de.startswith('darwin') or de.startswith('win32') or de.startswith('python') or de.startswith('node'):
                                filePath = os.path.join(plugin_volume, de)
                                print('Removing old dependencies: %s' %
                                      filePath)
                                try:
                                    shutil.rmtree(filePath)
                                except:
                                    pass
                    except:
                        pass

                    os.makedirs(python_prefix)

                    print('requirements.txt (outdated)')
                    print(str_requirements)

                    f = open(requirementstxt, 'wb')
                    f.write(requirements)
                    f.close()

                    try:
                        pythonVersion = packageJson['scrypted']['pythonVersion']
                    except:
                        pythonVersion = None

                    pipArgs = [
                        sys.executable,
                        '-m', 'pip', 'install', '-r', requirementstxt,
                        '--prefix', python_prefix
                    ]
                    if pythonVersion:
                        print('Specific Python version requested. Forcing reinstall.')
                        # prevent uninstalling system packages.
                        pipArgs.append('--ignore-installed')
                        # force reinstall even if it exists in system packages.
                        pipArgs.append('--force-reinstall')

                    p = subprocess.Popen(pipArgs, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

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
                # local/lib/dist-packages seen on python3.10 on ubuntu.
                # TODO: find a way to programatically get this value, or switch to venv.
                dist_packages = os.path.join(
                    python_prefix, 'local', 'lib', python_version, 'dist-packages')
                if os.path.exists(dist_packages):
                    site_packages = dist_packages
                else:
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

        await self.start_stats_runner()

        try:
            from scrypted_sdk import sdk_init2  # type: ignore

            sdk.systemManager = self.systemManager
            sdk.deviceManager = self.deviceManager
            sdk.mediaManager = self.mediaManager
            sdk.remote = self
            sdk.api = self.api
            sdk.zip = zip

            def host_fork() -> PluginFork:
                parent_conn, child_conn = multiprocessing.Pipe()
                pluginFork = PluginFork()
                print('new fork')
                pluginFork.worker = multiprocessing.Process(
                    target=plugin_fork, args=(child_conn,), daemon=True)
                pluginFork.worker.start()

                def schedule_exit_check():
                    def exit_check():
                        if pluginFork.worker.exitcode != None:
                            pluginFork.worker.join()
                        else:
                            schedule_exit_check()
                    self.loop.call_later(2, exit_check)

                schedule_exit_check()

                async def getFork():
                    rpcTransport = rpc_reader.RpcConnectionTransport(
                        parent_conn)
                    forkPeer, readLoop = await rpc_reader.prepare_peer_readloop(self.loop, rpcTransport)
                    forkPeer.peerName = 'thread'

                    async def updateStats(stats):
                        self.ptimeSum += stats['cpu']['user']
                        self.allMemoryStats[forkPeer] = stats
                    forkPeer.params['updateStats'] = updateStats

                    async def forkReadLoop():
                        try:
                            await readLoop()
                        except:
                            # traceback.print_exc()
                            print('fork read loop exited')
                        finally:
                            self.allMemoryStats.pop(forkPeer)
                            parent_conn.close()
                            rpcTransport.executor.shutdown()
                            pluginFork.worker.kill()
                    asyncio.run_coroutine_threadsafe(
                        forkReadLoop(), loop=self.loop)
                    getRemote = await forkPeer.getParam('getRemote')
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
            # sdk.

            sdk_init2(sdk)
        except:
            from scrypted_sdk import sdk_init  # type: ignore
            sdk_init(zip, self, self.systemManager,
                     self.deviceManager, self.mediaManager)

        if not forkMain:
            from main import create_scrypted_plugin  # type: ignore
            return await rpc.maybe_await(create_scrypted_plugin())

        from main import fork  # type: ignore
        forked = await rpc.maybe_await(fork())
        if type(forked) == dict:
            forked[rpc.RpcPeer.PROPERTY_JSON_COPY_SERIALIZE_CHILDREN] = True
        return forked

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

    async def start_stats_runner(self):
        update_stats = await self.peer.getParam('updateStats')
        if not update_stats:
            print('host did not provide update_stats')
            return

        def stats_runner():
            ptime = round(time.process_time() * 1000000) + self.ptimeSum
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

            for _, stats in self.allMemoryStats.items():
                heapTotal += stats['memoryUsage']['heapTotal']

            stats = {
                'cpu': {
                    'user': ptime,
                    'system': 0,
                },
                'memoryUsage': {
                    'heapTotal': heapTotal,
                },
            }
            asyncio.run_coroutine_threadsafe(update_stats(stats), self.loop)
            self.loop.call_later(10, stats_runner)

        stats_runner()


async def plugin_async_main(loop: AbstractEventLoop, rpcTransport: rpc_reader.RpcTransport):
    peer, readLoop = await rpc_reader.prepare_peer_readloop(loop, rpcTransport)
    peer.params['print'] = print
    peer.params['getRemote'] = lambda api, pluginId, hostInfo: PluginRemote(
        peer, api, pluginId, hostInfo, loop)

    try:
        await readLoop()
    finally:
        os._exit(0)


def main(rpcTransport: rpc_reader.RpcTransport):
    loop = asyncio.new_event_loop()

    def gc_runner():
        gc.collect()
        loop.call_later(10, gc_runner)
    gc_runner()

    loop.run_until_complete(plugin_async_main(loop, rpcTransport))
    loop.close()


def plugin_main(rpcTransport: rpc_reader.RpcTransport):
    # gi import will fail on windows (and posisbly elsewhere)
    # if it does, try starting without it.
    try:
        import gi
        gi.require_version('Gst', '1.0')
        from gi.repository import GLib, Gst
        Gst.init(None)

        # can't remember why starting the glib main loop is necessary.
        # maybe gstreamer on linux and other things needed it?
        # seems optional on other platforms.
        loop = GLib.MainLoop()

        worker = threading.Thread(target=main, args=(
            rpcTransport,), name="asyncio-main")
        worker.start()

        loop.run()
        return
    except:
        pass

    # reattempt without gi outside of the exception handler in case the plugin fails.
    main(rpcTransport)


def plugin_fork(conn: multiprocessing.connection.Connection):
    plugin_main(rpc_reader.RpcConnectionTransport(conn))


if __name__ == "__main__":
    plugin_main(rpc_reader.RpcFileTransport(3, 4))
