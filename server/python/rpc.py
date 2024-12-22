import inspect
import random
import string
import traceback
import weakref
from asyncio.futures import Future
from typing import Any, Callable, Dict, List, Mapping, TypedDict

jsonSerializable = set()
jsonSerializable.add(float)
jsonSerializable.add(int)
jsonSerializable.add(str)
jsonSerializable.add(dict)
jsonSerializable.add(bool)
jsonSerializable.add(list)


async def maybe_await(value):
    if inspect.isawaitable(value):
        return await value
    return value


class RPCResultError(Exception):
    # i think this stuff shouldn't be here...
    name: str
    stack: str
    message: str
    caught: Exception

    def __init__(self, caught, message):
        self.caught = caught
        self.message = message
        self.name = None
        self.stack = None


class RpcSerializer:
    def serialize(self, value, serializationContext):
        pass

    def deserialize(self, value, deserializationContext):
        pass


class RpcProxyMethod:
    def __init__(self, proxy, name):
        self.__proxy = proxy
        self.__proxy_method_name = name

    def __call__(self, *args, **kwargs):
        return self.__proxy.__apply__(self.__proxy_method_name, args)


class LocalProxiedEntry(TypedDict):
    id: str
    finalizerId: str


class RpcProxy(object):
    def __init__(
        self,
        peer,
        entry: LocalProxiedEntry,
        proxyConstructorName: str,
        proxyProps: any,
        proxyOneWayMethods: List[str],
    ):
        self.__dict__["__proxy_id"] = entry["id"]
        self.__dict__["__proxy_entry"] = entry
        self.__dict__["__proxy_constructor"] = proxyConstructorName
        self.__dict__[RpcPeer.PROPERTY_PROXY_PEER] = peer
        self.__dict__[RpcPeer.PROPERTY_PROXY_PROPERTIES] = proxyProps
        self.__dict__["__proxy_oneway_methods"] = proxyOneWayMethods

    def __aiter__(self):
        if (
            self.__dict__[RpcPeer.PROPERTY_PROXY_PROPERTIES]
            and "Symbol(Symbol.asyncIterator)"
            in self.__dict__[RpcPeer.PROPERTY_PROXY_PROPERTIES]
        ):
            return self
        raise Exception("RpcProxy is not an async iterable")

    async def __anext__(self):
        if (
            self.__dict__[RpcPeer.PROPERTY_PROXY_PROPERTIES]
            and "Symbol(Symbol.asyncIterator)"
            in self.__dict__[RpcPeer.PROPERTY_PROXY_PROPERTIES]
        ):
            try:
                return await RpcProxyMethod(
                    self,
                    self.__dict__[RpcPeer.PROPERTY_PROXY_PROPERTIES][
                        "Symbol(Symbol.asyncIterator)"
                    ]["next"],
                )()
            except RPCResultError as e:
                if e.name == "StopAsyncIteration":
                    raise StopAsyncIteration()
                raise
        raise Exception("RpcProxy is not an async iterable")

    async def aclose(self):
        if (
            self.__dict__[RpcPeer.PROPERTY_PROXY_PROPERTIES]
            and "Symbol(Symbol.asyncIterator)"
            in self.__dict__[RpcPeer.PROPERTY_PROXY_PROPERTIES]
        ):
            try:
                return await RpcProxyMethod(
                    self,
                    self.__dict__[RpcPeer.PROPERTY_PROXY_PROPERTIES][
                        "Symbol(Symbol.asyncIterator)"
                    ]["return"],
                )()
            except Exception:
                return
        raise Exception("RpcProxy is not an async iterable")

    def __getattr__(self, name):
        if name == "__proxy_finalizer_id":
            return self.dict["__proxy_entry"]["finalizerId"]
        if name in self.__dict__:
            return self.__dict__[name]
        if (
            self.__dict__[RpcPeer.PROPERTY_PROXY_PROPERTIES]
            and name in self.__dict__[RpcPeer.PROPERTY_PROXY_PROPERTIES]
        ):
            return self.__dict__[RpcPeer.PROPERTY_PROXY_PROPERTIES][name]
        return RpcProxyMethod(self, name)

    def __setattr__(self, name: str, value: Any) -> None:
        if name == "__proxy_finalizer_id":
            self.__dict__["__proxy_entry"]["finalizerId"] = value

        return super().__setattr__(name, value)

    def __call__(self, *args, **kwargs):
        return self.__dict__[RpcPeer.PROPERTY_PROXY_PEER].__apply__(
            self.__dict__["__proxy_id"],
            self.__dict__["__proxy_oneway_methods"],
            None,
            args,
        )

    def __apply__(self, method: str, args: list):
        return self.__dict__[RpcPeer.PROPERTY_PROXY_PEER].__apply__(
            self.__dict__["__proxy_id"],
            self.__dict__["__proxy_oneway_methods"],
            method,
            args,
        )


class RpcPeer:
    RPC_RESULT_ERROR_NAME = "RPCResultError"
    PROPERTY_PROXY_PROPERTIES = "__proxy_props"
    PROPERTY_JSON_COPY_SERIALIZE_CHILDREN = "__json_copy_serialize_children"
    PROPERTY_PROXY_PEER = "__proxy_peer"

    def __init__(
        self, send: Callable[[object, Callable[[Exception], None], Dict], None]
    ) -> None:
        self.send = send
        self.peerName = "Unnamed Peer"
        self.params: Mapping[str, any] = {}
        self.localProxied: Mapping[any, LocalProxiedEntry] = {}
        self.localProxyMap: Mapping[str, any] = {}
        self.constructorSerializerMap = {}
        self.pendingResults: Mapping[str, Future] = {}
        self.remoteWeakProxies: Mapping[str, any] = {}
        self.nameDeserializerMap: Mapping[str, RpcSerializer] = {}
        self.onProxySerialization: Callable[[Any, str], tuple[str, Any]] = None
        self.killed = False
        self.tags = {}

    def __apply__(
        self, proxyId: str, oneWayMethods: List[str], method: str, args: list
    ):
        oneway = oneWayMethods and method in oneWayMethods

        if self.killed:
            future = Future()
            if oneway:
                future.set_result(None)
                return future
            future.set_exception(
                RPCResultError(None, "RpcPeer has been killed (apply) " + str(method))
            )
            return future

        serializationContext: Dict = {}
        serializedArgs = []
        for arg in args:
            serializedArgs.append(self.serialize(arg, serializationContext))

        rpcApply = {
            "type": "apply",
            "id": None,
            "proxyId": proxyId,
            "args": serializedArgs,
            "method": method,
        }

        if oneway:
            rpcApply["oneway"] = True
            self.send(rpcApply, None, serializationContext)
            future = Future()
            future.set_result(None)
            return future

        async def send(id: str, reject: Callable[[Exception], None]):
            rpcApply["id"] = id
            self.send(rpcApply, reject, serializationContext)

        return self.createPendingResult(send)

    def kill(self, message: str = None):
        # not thread safe..
        if self.killed:
            return
        self.killed = True

        error = RPCResultError(None, message or "peer was killed")
        # this.killedDeferred.reject(error);
        for str, future in self.pendingResults.items():
            future.set_exception(error)

        self.pendingResults = None
        self.params = None
        self.remoteWeakProxies = None
        self.localProxyMap = None
        self.localProxied = None

    def createErrorResult(self, result: Any, e: Exception):
        s = self.serializeError(e)
        result["result"] = s
        result["throw"] = True
        return result

    def deserializeError(e: Dict) -> RPCResultError:
        error = RPCResultError(None, e.get("message"))
        error.stack = e.get("stack")
        error.name = e.get("name")
        return error

    def serializeError(self, e: Exception):
        tb = traceback.format_exc()
        name = type(e).__name__
        message = str(e)

        serialized = {
            "stack": tb or "[no stack]",
            "name": name or "[no name]",
            "message": message or "[no message]",
        }

        return {
            "__remote_constructor_name": RpcPeer.RPC_RESULT_ERROR_NAME,
            "__serialized_value": serialized,
        }

    # def getProxyProperties(value):
    #     return getattr(value, RpcPeer.PROPERTY_PROXY_PROPERTIES, None)

    # def setProxyProperties(value, properties):
    #     setattr(value, RpcPeer.PROPERTY_PROXY_PROPERTIES, properties)

    def prepareProxyProperties(value):
        if not hasattr(value, "__aiter__") or not hasattr(value, "__anext__"):
            return getattr(value, RpcPeer.PROPERTY_PROXY_PROPERTIES, None)

        props = getattr(value, RpcPeer.PROPERTY_PROXY_PROPERTIES, None) or {}
        if not props.get("Symbol(Symbol.asyncIterator)"):
            props["Symbol(Symbol.asyncIterator)"] = {
                "next": "__anext__",
                "throw": "athrow",
                "return": "aclose",
            }
        return props

    def isTransportSafe(value: any):
        return not value or (type(value) in jsonSerializable)

    def serialize(self, value, serializationContext: Dict):
        if type(value) == dict and value.get(
            RpcPeer.PROPERTY_JSON_COPY_SERIALIZE_CHILDREN, None
        ):
            ret = {}
            for key, val in value.items():
                ret[key] = self.serialize(val, serializationContext)
            return ret

        if getattr(value, RpcPeer.PROPERTY_JSON_COPY_SERIALIZE_CHILDREN, None) == True:
            array = []
            for key, val in value.items():
                array[key] = self.serialize(val, serializationContext)
            return {
                RpcPeer.PROPERTY_JSON_COPY_SERIALIZE_CHILDREN: array
            }

        if RpcPeer.isTransportSafe(value):
            return value

        __remote_constructor_name = (
            "Function"
            if callable(value)
            else (
                value.__proxy_constructor
                if hasattr(value, "__proxy_constructor")
                else type(value).__name__
            )
        )

        if isinstance(value, Exception):
            return self.serializeError(value)

        serializerMapName = self.constructorSerializerMap.get(type(value), None)
        if serializerMapName:
            __remote_constructor_name = serializerMapName
            serializer = self.nameDeserializerMap.get(serializerMapName, None)
            serialized = serializer.serialize(value, serializationContext)
            ret = {
                "__remote_proxy_id": None,
                "__remote_proxy_finalizer_id": None,
                "__remote_constructor_name": __remote_constructor_name,
                "__remote_proxy_props": RpcPeer.prepareProxyProperties(value),
                "__remote_proxy_oneway_methods": getattr(
                    value, "__proxy_oneway_methods", None
                ),
                "__serialized_value": serialized,
            }
            return ret

        proxiedEntry = self.localProxied.get(value, None)
        if proxiedEntry:
            if self.onProxySerialization:
                proxyId, __remote_proxy_props = self.onProxySerialization(value)
            else:
                __remote_proxy_props = RpcPeer.prepareProxyProperties(value)
                proxyId = proxiedEntry["id"]

            if proxyId != proxiedEntry["id"]:
                raise Exception("onProxySerialization proxy id mismatch")

            proxiedEntry["finalizerId"] = RpcPeer.generateId()
            ret = {
                "__remote_proxy_id": proxyId,
                "__remote_proxy_finalizer_id": proxiedEntry["finalizerId"],
                "__remote_constructor_name": __remote_constructor_name,
                "__remote_proxy_props": __remote_proxy_props,
                "__remote_proxy_oneway_methods": getattr(
                    value, "__proxy_oneway_methods", None
                ),
            }
            return ret

        __proxy_id = getattr(value, "__proxy_id", None)
        __proxy_peer = getattr(value, RpcPeer.PROPERTY_PROXY_PEER, None)
        if __proxy_id and __proxy_peer == self:
            ret = {
                "__local_proxy_id": __proxy_id,
            }
            return ret

        if self.onProxySerialization:
            proxyId, __remote_proxy_props = self.onProxySerialization(value)
        else:
            __remote_proxy_props = RpcPeer.prepareProxyProperties(value)
            proxyId = RpcPeer.generateId()

        proxiedEntry = {
            "id": proxyId,
            "finalizerId": proxyId,
        }
        self.localProxied[value] = proxiedEntry
        self.localProxyMap[proxyId] = value

        ret = {
            "__remote_proxy_id": proxyId,
            "__remote_proxy_finalizer_id": proxyId,
            "__remote_constructor_name": __remote_constructor_name,
            "__remote_proxy_props": __remote_proxy_props,
            "__remote_proxy_oneway_methods": getattr(
                value, "__proxy_oneway_methods", None
            ),
        }

        return ret

    def finalize(self, localProxiedEntry: LocalProxiedEntry):
        if self.killed:
            return
        id = localProxiedEntry["id"]
        self.remoteWeakProxies.pop(id, None)
        rpcFinalize = {
            "__local_proxy_id": id,
            "__local_proxy_finalizer_id": localProxiedEntry["finalizerId"],
            "type": "finalize",
        }
        self.send(rpcFinalize)

    def newProxy(
        self,
        proxyId: str,
        proxyConstructorName: str,
        proxyProps: any,
        proxyOneWayMethods: List[str],
    ):
        localProxiedEntry: LocalProxiedEntry = {
            "id": proxyId,
            "finalizerId": None,
        }
        proxy = RpcProxy(
            self,
            localProxiedEntry,
            proxyConstructorName,
            proxyProps,
            proxyOneWayMethods,
        )
        wr = weakref.ref(proxy)
        self.remoteWeakProxies[proxyId] = wr
        weakref.finalize(proxy, lambda: self.finalize(localProxiedEntry))
        return proxy

    def deserialize(self, value, deserializationContext: Dict):
        if not value:
            return value

        if type(value) != dict:
            return value

        copySerializeChildren = value.get(
            RpcPeer.PROPERTY_JSON_COPY_SERIALIZE_CHILDREN, None
        )
        if copySerializeChildren:
            if type(copySerializeChildren) == list:
                array = []
                for val in copySerializeChildren:
                    array.append(self.deserialize(val, deserializationContext))
                return array

            ret = {}
            for key, val in value.items():
                ret[key] = self.deserialize(val, deserializationContext)
            return ret

        __remote_proxy_id = value.get("__remote_proxy_id", None)
        __remote_proxy_finalizer_id = value.get("__remote_proxy_finalizer_id", None)
        __local_proxy_id = value.get("__local_proxy_id", None)
        __remote_constructor_name = value.get("__remote_constructor_name", None)
        __serialized_value = value.get("__serialized_value", None)
        __remote_proxy_props = value.get("__remote_proxy_props", None)
        __remote_proxy_oneway_methods = value.get("__remote_proxy_oneway_methods", None)

        if __remote_constructor_name == RpcPeer.RPC_RESULT_ERROR_NAME:
            return RpcPeer.deserializeError(__serialized_value)

        if __remote_proxy_id:
            weakref = self.remoteWeakProxies.get(__remote_proxy_id, None)
            proxy = weakref() if weakref else None
            if not proxy:
                proxy = self.newProxy(
                    __remote_proxy_id,
                    __remote_constructor_name,
                    __remote_proxy_props,
                    __remote_proxy_oneway_methods,
                )
            setattr(proxy, "__proxy_finalizer_id", __remote_proxy_finalizer_id)
            return proxy

        if __local_proxy_id:
            ret = self.localProxyMap.get(__local_proxy_id, None)
            if not ret:
                raise RPCResultError(
                    None, "invalid local proxy id %s" % __local_proxy_id
                )
            return ret

        deserializer = self.nameDeserializerMap.get(__remote_constructor_name, None)
        if deserializer:
            return deserializer.deserialize(__serialized_value, deserializationContext)

        return value

    def sendResult(self, result: Dict, serializationContext: Dict):
        self.send(
            result,
            lambda e: self.send(self.createErrorResult(result, e, None), None),
            serializationContext,
        )

    async def handleMessage(self, message: Dict, deserializationContext: Dict):
        try:
            messageType = message["type"]
            if messageType == "param":
                result = {
                    "type": "result",
                    "id": message["id"],
                }

                serializationContext: Dict = {}
                try:
                    value = self.params.get(message["param"], None)
                    value = await maybe_await(value)
                    result["result"] = self.serialize(value, serializationContext)
                except Exception as e:
                    tb = traceback.format_exc()
                    self.createErrorResult(result, type(e).__name, str(e), tb)

                self.sendResult(result, serializationContext)

            elif messageType == "apply":
                result = {
                    "type": "result",
                    "id": message.get("id", None),
                }
                method = message.get("method", None)

                try:
                    serializationContext: Dict = {}
                    target = self.localProxyMap.get(message["proxyId"], None)
                    if not target:
                        raise Exception("proxy id %s not found" % message["proxyId"])

                    args = []
                    for arg in message["args"] or []:
                        args.append(self.deserialize(arg, deserializationContext))

                    # if method == 'asend' and hasattr(target, '__aiter__') and hasattr(target, '__anext__') and not len(args):
                    #     args.append(None)

                    value = None
                    if method:
                        if not hasattr(target, method):
                            raise Exception(
                                "target %s does not have method %s"
                                % (type(target), method)
                            )
                        invoke = getattr(target, method)
                        value = await maybe_await(invoke(*args))
                    else:
                        value = await maybe_await(target(*args))

                    result["result"] = self.serialize(value, serializationContext)
                except StopAsyncIteration as e:
                    self.createErrorResult(result, e)
                except Exception as e:
                    self.createErrorResult(result, e)

                if not message.get("oneway", False):
                    self.sendResult(result, serializationContext)

            elif messageType == "result":
                id = message["id"]
                future = self.pendingResults.get(id, None)
                if not future:
                    raise RPCResultError(None, "unknown result %s" % id)
                del self.pendingResults[id]
                deserialized = self.deserialize(
                    message.get("result", None), deserializationContext
                )
                if message.get("throw"):
                    future.set_exception(deserialized)
                else:
                    future.set_result(deserialized)
            elif messageType == "finalize":
                finalizerId = message.get("__local_proxy_finalizer_id", None)
                proxyId = message["__local_proxy_id"]
                local = self.localProxyMap.get(proxyId, None)
                if local:
                    localProxiedEntry = self.localProxied.get(local)
                    if (
                        localProxiedEntry
                        and finalizerId
                        and localProxiedEntry["finalizerId"] != finalizerId
                    ):
                        # print('mismatch finalizer id', file=sys.stderr)
                        return
                    self.localProxied.pop(local, None)
                    local = self.localProxyMap.pop(proxyId, None)
            else:
                raise RPCResultError(None, "unknown rpc message type %s" % type)
        except Exception as e:
            print("unhandled rpc error", self.peerName, e)
            pass

    randomDigits = string.ascii_uppercase + string.ascii_lowercase + string.digits

    def generateId():
        return "".join(random.choices(RpcPeer.randomDigits, k=8))

    async def createPendingResult(
        self, cb: Callable[[str, Callable[[Exception], None]], None]
    ):
        future = Future()
        if self.killed:
            future.set_exception(
                RPCResultError(None, "RpcPeer has been killed (createPendingResult)")
            )
            return future

        id = RpcPeer.generateId()
        self.pendingResults[id] = future
        await cb(id, lambda e: future.set_exception(RPCResultError(e, None)))
        return await future

    async def getParam(self, param):
        async def send(id: str, reject: Callable[[Exception], None]):
            paramMessage = {
                "id": id,
                "type": "param",
                "param": param,
            }
            self.send(paramMessage, reject)

        return await self.createPendingResult(send)
