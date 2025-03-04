from __future__ import annotations

import asyncio
import gc
import inspect
import multiprocessing
import multiprocessing.connection
import os
from pathlib import Path
import platform
import random
import sys
import time
import traceback
import zipfile
from asyncio.events import AbstractEventLoop
from asyncio.futures import Future
from asyncio.streams import StreamReader, StreamWriter
from collections.abc import Mapping
from io import StringIO
from typing import Any, Callable, Coroutine, Optional, Set, Tuple, TypedDict
import plugin_console
import plugin_volume as pv
import rpc
import rpc_reader
import scrypted_python.scrypted_sdk.types
from cluster_setup import ClusterSetup
import cluster_labels
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

    def __init__(
        self, removeListener: Callable[[], None] | Coroutine[Any, None, None]
    ) -> None:
        self.removeListener = ensure_not_coroutine(removeListener)


class EventRegistry(object):
    systemListeners: Set[scrypted_python.scrypted_sdk.EventListener]
    listeners: Mapping[
        str, Set[Callable[[scrypted_python.scrypted_sdk.EventDetails, Any], None]]
    ]

    __allowedEventInterfaces = set(
        [ScryptedInterface.ScryptedDevice.value, "Logger"]
    )

    def __init__(self) -> None:
        self.systemListeners = set()
        self.listeners = {}

    def __getMixinEventName(
        self, options: str | scrypted_python.scrypted_sdk.EventListenerOptions
    ) -> str:
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

    def notify(
        self,
        id: str,
        eventTime: int,
        eventInterface: str,
        property: str,
        value: Any,
        options: dict = None,
    ):
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

    def notifyEventDetails(
        self,
        id: str,
        eventDetails: scrypted_python.scrypted_sdk.EventDetails,
        value: Any,
        eventInterface: str = None,
    ):
        if not eventDetails.get("eventId"):
            eventDetails["eventId"] = self.__generateBase36Str()
        if not eventInterface:
            eventInterface = eventDetails.get("eventInterface")

        # system listeners only get state changes.
        # there are many potentially noisy stateless events, like
        # object detection and settings changes
        if (eventDetails.get("property") and not eventDetails.get("mixinId")) or (
            eventInterface in EventRegistry.__allowedEventInterfaces
        ):
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


class ClusterManager(scrypted_python.scrypted_sdk.types.ClusterManager):
    def __init__(self, remote: PluginRemote):
        self.remote = remote
        self.clusterService = None

    def getClusterMode(self) -> Any | Any:
        return os.getenv("SCRYPTED_CLUSTER_MODE", None)

    def getClusterAddress(self) -> str:
        return os.getenv("SCRYPTED_CLUSTER_ADDRESS", None)

    def getClusterWorkerId(self) -> str:
        return self.remote.clusterSetup.clusterWorkerId

    async def getClusterWorkers(
        self,
    ) -> Mapping[str, scrypted_python.scrypted_sdk.types.ClusterWorker]:
        self.clusterService = self.clusterService or asyncio.ensure_future(
            self.remote.api.getComponent("cluster-fork")
        )
        cs = await self.clusterService
        return await cs.getClusterWorkers()


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
                id,
                options,
                lambda eventDetails, eventData: callback(
                    self.getDeviceById(id), eventDetails, eventData
                ),
            )

        register_fut = asyncio.ensure_future(
            self.api.listenDevice(
                id,
                options,
                lambda eventDetails, eventData: callback(
                    self.getDeviceById(id), eventDetails, eventData
                ),
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

    async def getFFmpegPath(self):
        # try to get the ffmpeg path as a value of another variable
        # ie, in docker builds:
        # export SCRYPTED_FFMPEG_PATH_ENV_VARIABLE=SCRYPTED_RASPBIAN_FFMPEG_PATH
        v = os.getenv('SCRYPTED_FFMPEG_PATH_ENV_VARIABLE')
        if v:
            f = os.getenv(v)
            if f and Path(f).exists():
                return f

        # try to get the ffmpeg path from a variable
        # ie:
        # export SCRYPTED_FFMPEG_PATH=/usr/local/bin/ffmpeg
        f = os.getenv('SCRYPTED_FFMPEG_PATH')
        if f and Path(f).exists():
            return f

        return await self.mediaManager.getFFmpegPath()

    async def getFilesPath(self):
        # Get the value of the SCRYPTED_PLUGIN_VOLUME environment variable
        files_path = os.getenv('SCRYPTED_PLUGIN_VOLUME')
        if not files_path:
            raise ValueError('SCRYPTED_PLUGIN_VOLUME env variable not set?')

        # Construct the path for the 'files' directory
        ret = Path(files_path) / 'files'

        # Ensure the directory exists
        await asyncio.to_thread(ret.mkdir, parents=True, exist_ok=True)

        # Return the constructed directory path as a string
        return str(ret)


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


class PeerLiveness:
    def __init__(self, loop: AbstractEventLoop):
        self.killed = Future(loop=loop)

    async def waitKilled(self):
        await self.killed


def safe_set_result(fut: Future, result: Any):
    try:
        fut.set_result(result)
    except:
        pass


class PluginRemote:
    def __init__(
        self,
        clusterSetup: ClusterSetup,
        api,
        pluginId: str,
        hostInfo,
        loop: AbstractEventLoop,
    ):
        self.systemState: Mapping[str, Mapping[str, SystemDeviceState]] = {}
        self.nativeIds: Mapping[str, DeviceStorage] = {}
        self.mediaManager: MediaManager
        self.clusterManager: ClusterManager
        self.consoles: Mapping[str, Future[Tuple[StreamReader, StreamWriter]]] = {}
        self.peer = clusterSetup.peer
        self.clusterSetup = clusterSetup
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
            port, hostname = await plugins.getRemoteServicePort(
                self.pluginId, "console-writer"
            )
            connection = await asyncio.open_connection(host=hostname, port=port)
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

    async def loadZip(self, packageJson, zipAPI: Any, options: dict):
        try:
            return await self.loadZipWrapped(packageJson, zipAPI, options)
        except:
            print("plugin start/fork failed")
            traceback.print_exc()
            raise

    async def loadZipWrapped(self, packageJson, zipAPI: Any, zipOptions: dict):
        await self.clusterSetup.initializeCluster(zipOptions)

        sdk = ScryptedStatic()

        sdk.connectRPCObject = lambda v: self.clusterSetup.connectRPCObject(v)

        forkMain = zipOptions and zipOptions.get("fork")
        debug = zipOptions.get("debug", None)
        plugin_volume = pv.ensure_plugin_volume(self.pluginId)
        zipHash: str = zipOptions.get("zipHash")
        plugin_zip_paths = pv.prep(plugin_volume, zipHash)

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
            zipData = await zipAPI.getZip()
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

        # forkMain may be set to true, but the environment may not be initialized
        # if the plugin is loaded in another cluster worker.
        # instead rely on a environemnt variable that will be passed to
        # child processes.
        if not os.environ.get("SCRYPTED_PYTHON_INITIALIZED", None):
            os.environ["SCRYPTED_PYTHON_INITIALIZED"] = "1"

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
            # pip is needed if there's a requirements.txt file that has changed.
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

            sys.path.append(plugin_zip_paths.get("unzipped_path"))
            sys.path.append(pip_target)

        self.systemManager = SystemManager(self.api, self.systemState)
        self.deviceManager = DeviceManager(self.nativeIds, self.systemManager)
        self.mediaManager = MediaManager(await self.api.getMediaManager())
        self.clusterManager = ClusterManager(self)

        try:
            sdk.systemManager = self.systemManager
            sdk.deviceManager = self.deviceManager
            sdk.mediaManager = self.mediaManager
            sdk.clusterManager = self.clusterManager
            sdk.remote = self
            sdk.api = self.api
            sdk.zip = zip

            def host_fork(options: dict = None) -> PluginFork:
                async def finishFork(forkPeer: rpc.RpcPeer):
                    getRemote = await forkPeer.getParam("getRemote")
                    remote: PluginRemote = await getRemote(
                        self.api, self.pluginId, self.hostInfo
                    )
                    await remote.setSystemState(self.systemManager.getSystemState())
                    for nativeId, ds in self.nativeIds.items():
                        await remote.setNativeId(nativeId, ds.id, ds.storage)
                    forkOptions = zipOptions.copy()
                    forkOptions["fork"] = True
                    forkOptions["debug"] = debug

                    class PluginZipAPI:

                        async def getZip(self):
                            return await zipAPI.getZip()

                    return await remote.loadZip(
                        packageJson, PluginZipAPI(), forkOptions
                    )

                if cluster_labels.needs_cluster_fork_worker(options):
                    peerLiveness = PeerLiveness(self.loop)

                    async def getClusterFork():
                        runtimeWorkerOptions = {
                            "packageJson": packageJson,
                            "env": None,
                            "pluginDebug": None,
                            "zipFile": None,
                            "unzippedPath": None,
                            "zipHash": zipHash,
                        }

                        forkComponent = await self.api.getComponent("cluster-fork")
                        sanitizedOptions = options.copy()
                        sanitizedOptions["runtime"] = sanitizedOptions.get(
                            "runtime", "python"
                        )
                        sanitizedOptions["zipHash"] = zipHash
                        clusterForkResult = await forkComponent.fork(
                            runtimeWorkerOptions,
                            sanitizedOptions,
                            peerLiveness,
                            lambda: zipAPI.getZip(),
                        )

                        async def waitClusterForkKilled():
                            try:
                                await clusterForkResult.waitKilled()
                            except:
                                pass
                            safe_set_result(peerLiveness.killed, None)

                        asyncio.ensure_future(waitClusterForkKilled(), loop=self.loop)

                        clusterGetRemote = await self.clusterSetup.connectRPCObject(
                            await clusterForkResult.getResult()
                        )
                        remoteDict = await clusterGetRemote()
                        asyncio.ensure_future(
                            plugin_console.writeWorkerGenerator(
                                remoteDict["stdout"], sys.stdout
                            )
                        )
                        asyncio.ensure_future(
                            plugin_console.writeWorkerGenerator(
                                remoteDict["stderr"], sys.stderr
                            )
                        )

                        getRemote = remoteDict["getRemote"]
                        directGetRemote = await self.clusterSetup.connectRPCObject(
                            getRemote
                        )
                        if directGetRemote is getRemote:
                            raise Exception("cluster fork peer not direct connected")

                        forkPeer = getattr(
                            directGetRemote, rpc.RpcPeer.PROPERTY_PROXY_PEER
                        )
                        return await finishFork(forkPeer)

                    async def getClusterForkWrapped():
                        try:
                            return await getClusterFork()
                        except:
                            safe_set_result(peerLiveness.killed, None)
                            raise

                    pluginFork = PluginFork()
                    pluginFork.result = asyncio.create_task(getClusterForkWrapped())

                    async def waitKilled():
                        await peerLiveness.killed

                    pluginFork.exit = asyncio.create_task(waitKilled())

                    def terminate():
                        safe_set_result(peerLiveness.killed, None)
                        pluginFork.worker.terminate()

                    pluginFork.terminate = terminate

                    pluginFork.worker = None

                    return pluginFork

                if options:
                    runtime = options.get("runtime", None)
                    if runtime and runtime != "python":
                        raise Exception("cross runtime fork not supported")
                    if options.get("filename", None):
                        raise Exception("python fork to filename not supported")

                parent_conn, child_conn = multiprocessing.Pipe()

                pluginFork = PluginFork()
                killed = Future(loop=self.loop)

                async def waitKilled():
                    await killed

                pluginFork.exit = asyncio.create_task(waitKilled())

                def terminate():
                    safe_set_result(killed, None)
                    pluginFork.worker.kill()

                pluginFork.terminate = terminate

                pluginFork.worker = multiprocessing.Process(
                    target=plugin_fork, args=(child_conn,), daemon=True
                )
                pluginFork.worker.start()

                def schedule_exit_check():
                    def exit_check():
                        if pluginFork.worker.exitcode != None:
                            safe_set_result(killed, None)
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

                    async def forkReadLoop():
                        try:
                            await readLoop()
                        except:
                            # traceback.print_exc()
                            print("fork read loop exited")
                        finally:
                            parent_conn.close()
                            rpcTransport.executor.shutdown()
                            pluginFork.terminate()

                    asyncio.run_coroutine_threadsafe(forkReadLoop(), loop=self.loop)

                    return await finishFork(forkPeer)

                pluginFork.result = asyncio.create_task(getFork())
                return pluginFork

            sdk.fork = host_fork
            # sdk.

            from scrypted_sdk import sdk_init2  # type: ignore

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
            return [self.replPort, os.getenv("SCRYPTED_CLUSTER_ADDRESS", None)]
        raise Exception(f"unknown service {name}")


async def plugin_async_main(
    loop: AbstractEventLoop, rpcTransport: rpc_reader.RpcTransport
):
    peer, readLoop = await rpc_reader.prepare_peer_readloop(loop, rpcTransport)
    peer.params["print"] = print

    clusterSetup = ClusterSetup(loop, peer)
    peer.params["initializeCluster"] = lambda options: clusterSetup.initializeCluster(
        options
    )

    async def ping(time: int):
        return time

    peer.params["ping"] = ping

    peer.params["getRemote"] = lambda api, pluginId, hostInfo: PluginRemote(
        clusterSetup, api, pluginId, hostInfo, loop
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


def plugin_fork(conn: multiprocessing.connection.Connection):
    main(rpc_reader.RpcConnectionTransport(conn))


if __name__ == "__main__":
    main(rpc_reader.RpcFileTransport(3, 4))
