from __future__ import annotations

import asyncio
import base64
import gc
import hashlib
import inspect
import multiprocessing
import multiprocessing.connection
import os
import platform
import random
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
from typing import Any, Optional, Set, Tuple, TypedDict, Callable, Coroutine

import plugin_volume as pv
import rpc
import rpc_reader
import scrypted_python.scrypted_sdk.types
from plugin_pip import install_with_pip, need_requirements, remove_pip_dirs
from scrypted_python.scrypted_sdk import PluginFork, ScryptedStatic
from scrypted_python.scrypted_sdk.types import (
    Device,
    DeviceManifest,
    EventDetails,
    ScryptedInterface,
    ScryptedInterfaceMethods,
    ScryptedInterfaceProperty,
    Storage,
)

SCRYPTED_REQUIREMENTS = """
ptpython
wheel
""".strip()


class ClusterObject(TypedDict):
    id: str
    address: str
    port: int
    proxyId: str
    sourceKey: str
    sha256: str


class SystemDeviceState(TypedDict):
    lastEventTime: int
    stateTime: int
    value: any


def ensure_not_coroutine(fn: Callable | Coroutine) -> Callable:
    if inspect.iscoroutinefunction(fn):
        def wrapper(*args, **kwargs):
            return asyncio.create_task(fn(*args, **kwargs))
        return wrapper
    return fn


class DeviceProxy(object):
    def __init__(self, systemManager: SystemManager, id: str):
        self.systemManager = systemManager
        self.id = id
        self.device: asyncio.Future[rpc.RpcProxy] = None

    def __getattr__(self, name):
        if name == "id":
            return self.id

        if hasattr(ScryptedInterfaceProperty, name):
            state = self.systemManager.systemState.get(self.id)
            if not state:
                return
            p = state.get(name)
            if not p:
                return
            return p.get("value", None)
        if hasattr(ScryptedInterfaceMethods, name):
            return rpc.RpcProxyMethod(self, name)

    def __setattr__(self, name: str, value: Any) -> None:
        if name == "__proxy_finalizer_id":
            self.__dict__["__proxy_entry"]["finalizerId"] = value

        return super().__setattr__(name, value)

    def __apply__(self, method: str, args: list):
        if not self.device:
            self.device = asyncio.ensure_future(
                self.systemManager.api.getDeviceById(self.id)
            )

        async def apply():
            device = await self.device
            return await device.__apply__(method, args)

        return apply()


class EventListenerRegisterImpl(scrypted_python.scrypted_sdk.EventListenerRegister):
    removeListener: Callable[[], None]

    def __init__(self, removeListener: Callable[[], None] | Coroutine[Any, None, None]) -> None:
        self.removeListener = ensure_not_coroutine(removeListener)


class EventRegistry(object):
    systemListeners: Set[scrypted_python.scrypted_sdk.EventListener]
    listeners: Mapping[str, Set[Callable[[scrypted_python.scrypted_sdk.EventDetails, Any], None]]]

    __allowedEventInterfaces = set([
        ScryptedInterface.ScryptedDevice.value,
        'Logger',
        'Storage'
    ])

    def __init__(self) -> None:
        self.systemListeners = set()
        self.listeners = {}

    def __getMixinEventName(self, options: str | scrypted_python.scrypted_sdk.EventListenerOptions) -> str:
        mixinId = None
        if type(options) == str:
            event = options
        else:
            options = options or {}
            event = options.get("event", None)
            mixinId = options.get("mixinId", None)
        if not event:
            event = "undefined"
        if not mixinId:
            return event
        return f"{event}-mixin-{mixinId}"

    def __generateBase36Str(self) -> str:
        alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
        return "".join(random.choices(alphabet, k=10))

    def listen(
        self, callback: scrypted_python.scrypted_sdk.EventListener
    ) -> scrypted_python.scrypted_sdk.EventListenerRegister:
        callback = ensure_not_coroutine(callback)
        self.systemListeners.add(callback)
        return EventListenerRegisterImpl(lambda: self.systemListeners.remove(callback))

    def listenDevice(
        self,
        id: str,
        options: str | scrypted_python.scrypted_sdk.EventListenerOptions,
        callback: Callable[[scrypted_python.scrypted_sdk.EventDetails, Any], None],
    ) -> scrypted_python.scrypted_sdk.EventListenerRegister:
        event = self.__getMixinEventName(options)
        token = f"{id}#{event}"
        events = self.listeners.get(token)
        if not events:
            events = set()
            self.listeners[token] = events
        callback = ensure_not_coroutine(callback)
        self.listeners[id].add(callback)
        return EventListenerRegisterImpl(lambda: self.listeners[id].remove(callback))

    def notify(self, id: str, eventTime: int, eventInterface: str, property: str, value: Any, options: dict = None):
        options = options or {}
        changed = options.get("changed")
        mixinId = options.get("mixinId")

        # prevent property event noise
        if property and not changed:
            return False

        eventDetails = {
            "eventId": None,
            "eventTime": eventTime,
            "eventInterface": eventInterface,
            "property": property,
            "mixinId": mixinId,
        }

        return self.notifyEventDetails(id, eventDetails, value)

    def notifyEventDetails(self, id: str, eventDetails: scrypted_python.scrypted_sdk.EventDetails, value: Any, eventInterface: str = None):
        if not eventDetails.get("eventId"):
            eventDetails["eventId"] = self.__generateBase36Str()
        if not eventInterface:
            eventInterface = eventDetails.get("eventInterface")

        # system listeners only get state changes.
        # there are many potentially noisy stateless events, like
        # object detection and settings changes
        if (eventDetails.get("property") and not eventDetails.get("mixinId")) or \
            (eventInterface in EventRegistry.__allowedEventInterfaces):
            for listener in self.systemListeners:
                listener(id, eventDetails, value)

        token = f"{id}#{eventInterface}"
        listeners = self.listeners.get(token)
        if listeners:
            for listener in listeners:
                listener(eventDetails, value)

        token = f"{id}#undefined"
        listeners = self.listeners.get(token)
        if listeners:
            for listener in listeners:
                listener(eventDetails, value)

        return True


class SystemManager(scrypted_python.scrypted_sdk.types.SystemManager):
    def __init__(
        self, api: Any, systemState: Mapping[str, Mapping[str, SystemDeviceState]]
    ) -> None:
        super().__init__()
        self.api = api
        self.systemState = systemState
        self.deviceProxies: Mapping[str, DeviceProxy] = {}
        self.events = EventRegistry()

    async def getComponent(self, id: str) -> Any:
        return await self.api.getComponent(id)

    def getSystemState(self) -> Any:
        return self.systemState

    def getDeviceById(
        self, idOrPluginId: str, nativeId: str = None
    ) -> scrypted_python.scrypted_sdk.ScryptedDevice:
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
                pluginId = state.get("pluginId", None)
                if not pluginId:
                    continue
                pluginId = pluginId.get("value", None)
                if pluginId == idOrPluginId:
                    checkNativeId = state.get("nativeId", None)
                    if not checkNativeId:
                        continue
                    checkNativeId = checkNativeId.get("value", None)
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
            checkInterfaces = state.get("interfaces", None)
            if not checkInterfaces:
                continue
            interfaces = checkInterfaces.get("value", [])
            if ScryptedInterface.ScryptedPlugin.value in interfaces:
                checkPluginId = state.get("pluginId", None)
                if not checkPluginId:
                    continue
                pluginId = checkPluginId.get("value", None)
                if not pluginId:
                    continue
                if pluginId == name:
                    return self.getDeviceById(check)
            checkName = state.get("name", None)
            if not checkName:
                continue
            if checkName.get("value", None) == name:
                return self.getDeviceById(check)

    def listen(
        self, callback: scrypted_python.scrypted_sdk.EventListener
    ) -> scrypted_python.scrypted_sdk.EventListenerRegister:
        return self.events.listen(callback)

    def listenDevice(
        self,
        id: str,
        options: str | scrypted_python.scrypted_sdk.EventListenerOptions,
        callback: scrypted_python.scrypted_sdk.EventListener,
    ) -> scrypted_python.scrypted_sdk.EventListenerRegister:
        callback = ensure_not_coroutine(callback)
        if type(options) != str and options.get("watch"):
            return self.events.listenDevice(
                id, options,
                lambda eventDetails, eventData: callback(self.getDeviceById(id), eventDetails, eventData)
            )

        register_fut = asyncio.ensure_future(
            self.api.listenDevice(
                id, options,
                lambda eventDetails, eventData: callback(self.getDeviceById(id), eventDetails, eventData)
            )
        )
        async def unregister():
            register = await register_fut
            await register.removeListener()
        return EventListenerRegisterImpl(lambda: asyncio.ensure_future(unregister()))

    async def removeDevice(self, id: str) -> None:
        return await self.api.removeDevice(id)


class MediaObject(scrypted_python.scrypted_sdk.types.MediaObject):
    def __init__(self, data, mimeType, options):
        self.data = data

        proxyProps = {}
        setattr(self, rpc.RpcPeer.PROPERTY_PROXY_PROPERTIES, proxyProps)

        options = options or {}
        options["mimeType"] = mimeType

        for key, value in options.items():
            if rpc.RpcPeer.isTransportSafe(value):
                proxyProps[key] = value
            setattr(self, key, value)

    async def getData(self):
        return self.data


class MediaManager:
    def __init__(self, mediaManager: scrypted_python.scrypted_sdk.types.MediaManager):
        self.mediaManager = mediaManager

    async def addConverter(
        self, converter: scrypted_python.scrypted_sdk.types.BufferConverter
    ) -> None:
        return await self.mediaManager.addConverter(converter)

    async def clearConverters(self) -> None:
        return await self.mediaManager.clearConverters()

    async def convertMediaObject(
        self,
        mediaObject: scrypted_python.scrypted_sdk.types.MediaObject,
        toMimeType: str,
    ) -> Any:
        return await self.mediaManager.convertMediaObject(mediaObject, toMimeType)

    async def convertMediaObjectToBuffer(
        self,
        mediaObject: scrypted_python.scrypted_sdk.types.MediaObject,
        toMimeType: str,
    ) -> bytearray:
        return await self.mediaManager.convertMediaObjectToBuffer(
            mediaObject, toMimeType
        )

    async def convertMediaObjectToInsecureLocalUrl(
        self,
        mediaObject: str | scrypted_python.scrypted_sdk.types.MediaObject,
        toMimeType: str,
    ) -> str:
        return await self.mediaManager.convertMediaObjectToInsecureLocalUrl(
            mediaObject, toMimeType
        )

    async def convertMediaObjectToJSON(
        self,
        mediaObject: scrypted_python.scrypted_sdk.types.MediaObject,
        toMimeType: str,
    ) -> Any:
        return await self.mediaManager.convertMediaObjectToJSON(mediaObject, toMimeType)

    async def convertMediaObjectToLocalUrl(
        self,
        mediaObject: str | scrypted_python.scrypted_sdk.types.MediaObject,
        toMimeType: str,
    ) -> str:
        return await self.mediaManager.convertMediaObjectToLocalUrl(
            mediaObject, toMimeType
        )

    async def convertMediaObjectToUrl(
        self,
        mediaObject: str | scrypted_python.scrypted_sdk.types.MediaObject,
        toMimeType: str,
    ) -> str:
        return await self.mediaManager.convertMediaObjectToUrl(mediaObject, toMimeType)

    async def createFFmpegMediaObject(
        self,
        ffmpegInput: scrypted_python.scrypted_sdk.types.FFmpegInput,
        options: scrypted_python.scrypted_sdk.types.MediaObjectOptions = None,
    ) -> scrypted_python.scrypted_sdk.types.MediaObject:
        return await self.mediaManager.createFFmpegMediaObject(ffmpegInput, options)

    async def createMediaObject(
        self,
        data: Any,
        mimeType: str,
        options: scrypted_python.scrypted_sdk.types.MediaObjectOptions = None,
    ) -> scrypted_python.scrypted_sdk.types.MediaObject:
        # return await self.createMediaObject(data, mimetypes, options)
        return MediaObject(data, mimeType, options)

    async def createMediaObjectFromUrl(
        self,
        data: str,
        options: scrypted_python.scrypted_sdk.types.MediaObjectOptions = None,
    ) -> scrypted_python.scrypted_sdk.types.MediaObject:
        return await self.mediaManager.createMediaObjectFromUrl(data, options)

    async def getFFmpegPath(self) -> str:
        return await self.mediaManager.getFFmpegPath()

    async def getFilesPath(self) -> str:
        return await self.mediaManager.getFilesPath()


class DeviceState(scrypted_python.scrypted_sdk.types.DeviceState):
    def __init__(
        self,
        id: str,
        nativeId: str,
        systemManager: SystemManager,
        deviceManager: scrypted_python.scrypted_sdk.types.DeviceManager,
    ) -> None:
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
        return sdd.get("value", None)

    def setScryptedProperty(self, property: str, value: Any):
        if property == ScryptedInterfaceProperty.id.value:
            raise Exception("id is read only")
        if property == ScryptedInterfaceProperty.mixins.value:
            raise Exception("mixins is read only")
        if property == ScryptedInterfaceProperty.interfaces.value:
            raise Exception(
                "interfaces is a read only post-mixin computed property, use providedInterfaces"
            )

        now = int(time.time() * 1000)
        self.systemManager.systemState[self._id][property] = {
            "lastEventTime": now,
            "stateTime": now,
            "value": value,
        }

        self.systemManager.api.setState(self.nativeId, property, value)


class WritableDeviceState(scrypted_python.scrypted_sdk.types.WritableDeviceState):

    def __init__(self, id, setState) -> None:
        self.id = id
        self.setState = setState


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
    def __init__(
        self, nativeIds: Mapping[str, DeviceStorage], systemManager: SystemManager
    ) -> None:
        super().__init__()
        self.nativeIds = nativeIds
        self.systemManager = systemManager

    def getDeviceState(self, nativeId: str) -> DeviceState:
        id = self.nativeIds[nativeId].id
        return DeviceState(id, nativeId, self.systemManager, self)

    async def onDeviceEvent(
        self, nativeId: str, eventInterface: str, eventData: Any = None
    ) -> None:
        await self.systemManager.api.onDeviceEvent(nativeId, eventInterface, eventData)

    async def onDevicesChanged(self, devices: DeviceManifest) -> None:
        return await self.systemManager.api.onDevicesChanged(devices)

    async def onDeviceDiscovered(self, devices: Device) -> str:
        return await self.systemManager.api.onDeviceDiscovered(devices)

    async def onDeviceRemoved(self, nativeId: str) -> None:
        return await self.systemManager.api.onDeviceRemoved(nativeId)

    async def onMixinEvent(
        self, id: str, mixinDevice: Any, eventInterface: str, eventData: Any
    ) -> None:
        return await self.systemManager.api.onMixinEvent(
            id, mixinDevice, eventInterface, eventData
        )

    async def requestRestart(self) -> None:
        return await self.systemManager.api.requestRestart()

    def getDeviceStorage(self, nativeId: str = None) -> Storage:
        return self.nativeIds.get(nativeId, None)


class PluginRemote:
    def __init__(
        self, peer: rpc.RpcPeer, api, pluginId: str, hostInfo, loop: AbstractEventLoop
    ):
        self.systemState: Mapping[str, Mapping[str, SystemDeviceState]] = {}
        self.nativeIds: Mapping[str, DeviceStorage] = {}
        self.mediaManager: MediaManager
        self.consoles: Mapping[str, Future[Tuple[StreamReader, StreamWriter]]] = {}
        self.ptimeSum = 0
        self.allMemoryStats = {}
        self.peer = peer
        self.api = api
        self.pluginId = pluginId
        self.hostInfo = hostInfo
        self.loop = loop
        self.replPort = None
        self.__dict__["__proxy_oneway_methods"] = [
            "notify",
            "updateDeviceState",
            "setSystemState",
            "ioEvent",
            "setNativeId",
        ]
        self.peer.params["createMediaManager"] = lambda: api.getMediaManager()

    async def print_async(
        self,
        nativeId: str,
        *values: object,
        sep: Optional[str] = " ",
        end: Optional[str] = "\n",
        flush: bool = False,
    ):
        consoleFuture = self.consoles.get(nativeId)
        if not consoleFuture:
            consoleFuture = Future()
            self.consoles[nativeId] = consoleFuture
            plugins = await self.api.getComponent("plugins")
            port = await plugins.getRemoteServicePort(self.pluginId, "console-writer")
            connection = await asyncio.open_connection(port=port)
            _, writer = connection
            if not nativeId:
                nid = "undefined"
            else:
                nid = nativeId
            nid += "\n"
            writer.write(nid.encode("utf8"))
            consoleFuture.set_result(connection)
        _, writer = await consoleFuture
        strio = StringIO()
        print(*values, sep=sep, end=end, flush=flush, file=strio)
        strio.seek(0)
        b = strio.read().encode("utf8")
        writer.write(b)

    def print(
        self,
        nativeId: str,
        *values: object,
        sep: Optional[str] = " ",
        end: Optional[str] = "\n",
        flush: bool = False,
    ):
        asyncio.run_coroutine_threadsafe(
            self.print_async(nativeId, *values, sep=sep, end=end, flush=flush),
            self.loop,
        )

    async def loadZip(self, packageJson, getZip: Any, options: dict):
        try:
            return await self.loadZipWrapped(packageJson, getZip, options)
        except:
            print("plugin start/fork failed")
            traceback.print_exc()
            raise

    async def loadZipWrapped(self, packageJson, getZip: Any, options: dict):
        sdk = ScryptedStatic()

        clusterId = options["clusterId"]
        clusterSecret = options["clusterSecret"]
        SCRYPTED_CLUSTER_ADDRESS = os.environ.get("SCRYPTED_CLUSTER_ADDRESS", None)

        def computeClusterObjectHash(o: ClusterObject) -> str:
            m = hashlib.sha256()
            m.update(
                bytes(
                    f"{o['id']}{o.get('address') or ''}{o['port']}{o.get('sourceKey', None) or ''}{o['proxyId']}{clusterSecret}",
                    "utf8",
                )
            )
            return base64.b64encode(m.digest()).decode("utf-8")

        def isClusterAddress(address: str):
            return not address or address == SCRYPTED_CLUSTER_ADDRESS

        def onProxySerialization(peer: rpc.RpcPeer, value: Any, sourceKey: str = None):
            properties: dict = rpc.RpcPeer.prepareProxyProperties(value) or {}
            clusterEntry = properties.get("__cluster", None)
            proxyId: str
            existing = peer.localProxied.get(value, None)
            if existing:
                proxyId = existing["id"]
            else:
                proxyId = (
                    clusterEntry and clusterEntry.get("proxyId", None)
                ) or rpc.RpcPeer.generateId()

            if clusterEntry:
                if (
                    isClusterAddress(clusterEntry.get("address", None))
                    and clusterPort == clusterEntry["port"]
                    and sourceKey != clusterEntry.get("sourceKey", None)
                ):
                    clusterEntry = None

            if not clusterEntry:
                clusterEntry: ClusterObject = {
                    "id": clusterId,
                    "proxyId": proxyId,
                    "address": SCRYPTED_CLUSTER_ADDRESS,
                    "port": clusterPort,
                    "sourceKey": sourceKey,
                }
                clusterEntry["sha256"] = computeClusterObjectHash(clusterEntry)
                properties["__cluster"] = clusterEntry

            return proxyId, properties

        self.peer.onProxySerialization = lambda value: onProxySerialization(
            self.peer, value, None
        )

        async def resolveObject(id: str, sourceKey: str):
            sourcePeer: rpc.RpcPeer = (
                self.peer
                if not sourceKey
                else await rpc.maybe_await(clusterPeers.get(sourceKey, None))
            )
            if not sourcePeer:
                return
            return sourcePeer.localProxyMap.get(id, None)

        clusterPeers: Mapping[str, asyncio.Future[rpc.RpcPeer]] = {}

        def getClusterPeerKey(address: str, port: int):
            return f"{address}:{port}"

        async def handleClusterClient(
            reader: asyncio.StreamReader, writer: asyncio.StreamWriter
        ):
            clusterPeerAddress, clusterPeerPort = writer.get_extra_info("peername")
            clusterPeerKey = getClusterPeerKey(clusterPeerAddress, clusterPeerPort)
            rpcTransport = rpc_reader.RpcStreamTransport(reader, writer)
            peer: rpc.RpcPeer
            peer, peerReadLoop = await rpc_reader.prepare_peer_readloop(
                self.loop, rpcTransport
            )
            peer.onProxySerialization = lambda value: onProxySerialization(
                peer, value, clusterPeerKey
            )
            future: asyncio.Future[rpc.RpcPeer] = asyncio.Future()
            future.set_result(peer)
            clusterPeers[clusterPeerKey] = future

            async def connectRPCObject(o: ClusterObject):
                sha256 = computeClusterObjectHash(o)
                if sha256 != o["sha256"]:
                    raise Exception("secret incorrect")
                return await resolveObject(o["proxyId"], o.get("sourceKey", None))

            peer.params["connectRPCObject"] = connectRPCObject
            try:
                await peerReadLoop()
            except:
                pass
            finally:
                clusterPeers.pop(clusterPeerKey)
                peer.kill("cluster client killed")
                writer.close()

        listenAddress = "0.0.0.0" if SCRYPTED_CLUSTER_ADDRESS else "127.0.0.1"
        clusterRpcServer = await asyncio.start_server(
            handleClusterClient, listenAddress, 0
        )
        clusterPort = clusterRpcServer.sockets[0].getsockname()[1]

        def ensureClusterPeer(address: str, port: int):
            if isClusterAddress(address):
                address = "127.0.0.1"
            clusterPeerKey = getClusterPeerKey(address, port)
            clusterPeerPromise = clusterPeers.get(clusterPeerKey)
            if clusterPeerPromise:
                return clusterPeerPromise

            async def connectClusterPeer():
                try:
                    reader, writer = await asyncio.open_connection(address, port)
                    sourceAddress, sourcePort = writer.get_extra_info("sockname")
                    if (
                        sourceAddress != SCRYPTED_CLUSTER_ADDRESS
                        and sourceAddress != "127.0.0.1"
                    ):
                        print("source address mismatch", sourceAddress)
                    rpcTransport = rpc_reader.RpcStreamTransport(reader, writer)
                    clusterPeer, peerReadLoop = await rpc_reader.prepare_peer_readloop(
                        self.loop, rpcTransport
                    )
                    clusterPeer.onProxySerialization = (
                        lambda value: onProxySerialization(
                            clusterPeer, value, clusterPeerKey
                        )
                    )
                except:
                    clusterPeers.pop(clusterPeerKey)
                    raise

                async def run_loop():
                    try:
                        await peerReadLoop()
                    except:
                        pass
                    finally:
                        clusterPeers.pop(clusterPeerKey)

                asyncio.run_coroutine_threadsafe(run_loop(), self.loop)
                return clusterPeer

            clusterPeerPromise = self.loop.create_task(connectClusterPeer())

            clusterPeers[clusterPeerKey] = clusterPeerPromise
            return clusterPeerPromise

        async def connectRPCObject(value):
            __cluster = getattr(value, "__cluster")
            if type(__cluster) is not dict:
                return value

            clusterObject: ClusterObject = __cluster

            if clusterObject.get("id", None) != clusterId:
                return value

            address = clusterObject.get("address", None)
            port = clusterObject["port"]
            proxyId = clusterObject["proxyId"]
            if port == clusterPort:
                return await resolveObject(
                    proxyId, clusterObject.get("sourceKey", None)
                )

            clusterPeerPromise = ensureClusterPeer(address, port)

            try:
                clusterPeer = await clusterPeerPromise
                weakref = clusterPeer.remoteWeakProxies.get(proxyId, None)
                existing = weakref() if weakref else None
                if existing:
                    return existing

                peerConnectRPCObject = clusterPeer.tags.get("connectRPCObject")
                if not peerConnectRPCObject:
                    peerConnectRPCObject = await clusterPeer.getParam(
                        "connectRPCObject"
                    )
                    clusterPeer.tags["connectRPCObject"] = peerConnectRPCObject
                newValue = await peerConnectRPCObject(clusterObject)
                if not newValue:
                    raise Exception("rpc object not found?")
                return newValue
            except Exception as e:
                return value

        sdk.connectRPCObject = connectRPCObject

        forkMain = options and options.get("fork")
        debug = options.get("debug", None)
        plugin_volume = pv.ensure_plugin_volume(self.pluginId)
        plugin_zip_paths = pv.prep(plugin_volume, options.get("zipHash"))

        if debug:
            scrypted_volume = pv.get_scrypted_volume()
            # python debugger needs a predictable path for the plugin.zip,
            # as the vscode python extension doesn't seem to have a way
            # to read the package.json to configure the python remoteRoot.
            zipPath = os.path.join(scrypted_volume, "plugin.zip")
        else:
            zipPath = plugin_zip_paths.get("zip_file")

        if not os.path.exists(zipPath) or debug:
            os.makedirs(os.path.dirname(zipPath), exist_ok=True)
            zipData = await getZip()
            zipPathTmp = zipPath + ".tmp"
            with open(zipPathTmp, "wb") as f:
                f.write(zipData)
            try:
                os.remove(zipPath)
            except:
                pass
            os.rename(zipPathTmp, zipPath)

        zip = zipfile.ZipFile(zipPath)

        if not forkMain:
            multiprocessing.set_start_method("spawn")

            # it's possible to run 32bit docker on aarch64, which cause pip requirements
            # to fail because pip only allows filtering on machine, even if running a different architeture.
            # this will cause prebuilt wheel installation to fail.
            if (
                platform.machine() == "aarch64"
                and platform.architecture()[0] == "32bit"
            ):
                print("=============================================")
                print(
                    "Python machine vs architecture mismatch detected. Plugin installation may fail."
                )
                print(
                    "This issue occurs if a 32bit system was upgraded to a 64bit kernel."
                )
                print(
                    "Reverting to the 32bit kernel (or reflashing as native 64 bit is recommended."
                )
                print("https://github.com/koush/scrypted/issues/678")
                print("=============================================")

            python_version = (
                "python%s" % str(sys.version_info[0]) + "." + str(sys.version_info[1])
            )
            print("python version:", python_version)
            print("interpreter:", sys.executable)

            python_versioned_directory = "%s-%s-%s" % (
                python_version,
                platform.system(),
                platform.machine(),
            )
            SCRYPTED_PYTHON_VERSION = os.environ.get("SCRYPTED_PYTHON_VERSION")
            python_versioned_directory += "-" + SCRYPTED_PYTHON_VERSION

            pip_target = os.path.join(plugin_volume, python_versioned_directory)

            print("pip target: %s" % pip_target)

            if not os.path.exists(pip_target):
                os.makedirs(pip_target, exist_ok=True)

            def read_requirements(filename: str) -> str:
                if filename in zip.namelist():
                    return zip.open(filename).read().decode("utf8")
                return ""

            str_requirements = read_requirements("requirements.txt")
            str_optional_requirements = read_requirements("requirements.optional.txt")

            scrypted_requirements_basename = os.path.join(
                pip_target, "requirements.scrypted"
            )
            requirements_basename = os.path.join(pip_target, "requirements")
            optional_requirements_basename = os.path.join(
                pip_target, "requirements.optional"
            )

            need_pip = False
            # pip is needed if there's a requiremnts.txt file that has changed.
            if str_requirements:
                need_pip = need_requirements(requirements_basename, str_requirements)
            # pip is needed if the base scrypted requirements have changed.
            if not need_pip:
                need_pip = need_requirements(
                    scrypted_requirements_basename, SCRYPTED_REQUIREMENTS
                )

            if need_pip:
                remove_pip_dirs(plugin_volume)
                install_with_pip(
                    pip_target,
                    packageJson,
                    SCRYPTED_REQUIREMENTS,
                    scrypted_requirements_basename,
                    ignore_error=True,
                )
                install_with_pip(
                    pip_target,
                    packageJson,
                    str_requirements,
                    requirements_basename,
                    ignore_error=False,
                )
                install_with_pip(
                    pip_target,
                    packageJson,
                    str_optional_requirements,
                    optional_requirements_basename,
                    ignore_error=True,
                )
            else:
                print("requirements.txt (up to date)")
                print(str_requirements)

            sys.path.insert(0, plugin_zip_paths.get("unzipped_path"))
            sys.path.insert(0, pip_target)

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
                print("new fork")
                pluginFork.worker = multiprocessing.Process(
                    target=plugin_fork, args=(child_conn,), daemon=True
                )
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
                    rpcTransport = rpc_reader.RpcConnectionTransport(parent_conn)
                    forkPeer, readLoop = await rpc_reader.prepare_peer_readloop(
                        self.loop, rpcTransport
                    )
                    forkPeer.peerName = "thread"

                    async def updateStats(stats):
                        self.ptimeSum += stats["cpu"]["user"]
                        self.allMemoryStats[forkPeer] = stats

                    forkPeer.params["updateStats"] = updateStats

                    async def forkReadLoop():
                        try:
                            await readLoop()
                        except:
                            # traceback.print_exc()
                            print("fork read loop exited")
                        finally:
                            self.allMemoryStats.pop(forkPeer)
                            parent_conn.close()
                            rpcTransport.executor.shutdown()
                            pluginFork.worker.kill()

                    asyncio.run_coroutine_threadsafe(forkReadLoop(), loop=self.loop)
                    getRemote = await forkPeer.getParam("getRemote")
                    remote: PluginRemote = await getRemote(
                        self.api, self.pluginId, self.hostInfo
                    )
                    await remote.setSystemState(self.systemManager.getSystemState())
                    for nativeId, ds in self.nativeIds.items():
                        await remote.setNativeId(nativeId, ds.id, ds.storage)
                    forkOptions = options.copy()
                    forkOptions["fork"] = True
                    forkOptions["debug"] = debug
                    return await remote.loadZip(packageJson, getZip, forkOptions)

                pluginFork.result = asyncio.create_task(getFork())
                return pluginFork

            sdk.fork = host_fork
            # sdk.

            sdk_init2(sdk)
        except:
            from scrypted_sdk import sdk_init  # type: ignore

            sdk_init(
                zip, self, self.systemManager, self.deviceManager, self.mediaManager
            )

        # plugin embedded files are treated as the working directory, chdir to that.
        fsPath = os.path.join(plugin_zip_paths.get("unzipped_path"), "fs")
        os.makedirs(fsPath, exist_ok=True)
        os.chdir(fsPath)

        if not forkMain:
            from main import create_scrypted_plugin  # type: ignore

            pluginInstance = await rpc.maybe_await(create_scrypted_plugin())
            try:
                from plugin_repl import createREPLServer

                self.replPort = await createREPLServer(sdk, pluginInstance)
            except Exception as e:
                print(f"Warning: Python REPL cannot be loaded: {e}")
                self.replPort = 0
            return pluginInstance

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
        property = eventDetails.get("property")
        if property:
            state = None
            if self.systemState:
                state = self.systemState.get(id, None)
                if not state:
                    print("state not found for %s" % id)
                    return
                state[property] = value
                # systemManager.events.notify(id, eventTime, eventInterface, property, value.value, changed);
        else:
            # systemManager.events.notify(id, eventTime, eventInterface, property, value, changed);
            pass

    async def ioEvent(self, id, event, message=None):
        pass

    async def createDeviceState(self, id, setState):
        return WritableDeviceState(id, setState)

    async def getServicePort(self, name):
        if name == "repl":
            if self.replPort is None:
                raise Exception("REPL unavailable: Plugin not loaded.")
            if self.replPort == 0:
                raise Exception("REPL unavailable: Python REPL not available.")
            return self.replPort
        raise Exception(f"unknown service {name}")

    async def start_stats_runner(self):
        pong = None

        async def ping(time: int):
            nonlocal pong
            pong = pong or await self.peer.getParam("pong")
            await pong(time)

        self.peer.params["ping"] = ping

        update_stats = await self.peer.getParam("updateStats")
        if not update_stats:
            print("host did not provide update_stats")
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

                    heapTotal = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
                except:
                    heapTotal = 0

            for _, stats in self.allMemoryStats.items():
                heapTotal += stats["memoryUsage"]["heapTotal"]

            stats = {
                "cpu": {
                    "user": ptime,
                    "system": 0,
                },
                "memoryUsage": {
                    "heapTotal": heapTotal,
                },
            }
            asyncio.run_coroutine_threadsafe(update_stats(stats), self.loop)
            self.loop.call_later(10, stats_runner)

        stats_runner()


async def plugin_async_main(
    loop: AbstractEventLoop, rpcTransport: rpc_reader.RpcTransport
):
    peer, readLoop = await rpc_reader.prepare_peer_readloop(loop, rpcTransport)
    peer.params["print"] = print
    peer.params["getRemote"] = lambda api, pluginId, hostInfo: PluginRemote(
        peer, api, pluginId, hostInfo, loop
    )

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
    if True:
        main(rpcTransport)
        return

    # 03/05/2024
    # Not sure why this code below was necessary. I thought it was gstreamer needing to
    # be initialized on the main thread, but that no longer seems to be the case.

    # gi import will fail on windows (and posisbly elsewhere)
    # if it does, try starting without it.
    try:
        import gi

        gi.require_version("Gst", "1.0")
        from gi.repository import GLib, Gst

        Gst.init(None)

        # can't remember why starting the glib main loop is necessary.
        # maybe gstreamer on linux and other things needed it?
        # seems optional on other platforms.
        loop = GLib.MainLoop()

        worker = threading.Thread(
            target=main, args=(rpcTransport,), name="asyncio-main"
        )
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
