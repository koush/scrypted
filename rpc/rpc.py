from asyncio.events import AbstractEventLoop
from asyncio.futures import Future
from typing import Callable
import aiofiles
import asyncio
import json
import traceback
import inspect
import json
from collections.abc import Mapping, Sequence
import weakref

jsonSerializable = set()
jsonSerializable.add(float)
jsonSerializable.add(int)
jsonSerializable.add(str)
jsonSerializable.add(dict)
jsonSerializable.add(bool)
jsonSerializable.add(list)


async def maybe_await(value):
    if (inspect.iscoroutinefunction(value)):
        return await value
    return value


class RpcResultException(Exception):
    name = None
    stack = None

    def __init__(self, caught, message):
        self.caught = caught
        self.message = message


class RpcSerializer:
    def serialize(self, value):
        pass

    def deserialize(self, value):
        pass


class RpcProxyMethod:
    def __init__(self, proxy, name):
        self.__proxy = proxy
        self.__proxy_method_name = name

    def __call__(self, *args, **kwargs):
        return self.__proxy.__apply__(self.__proxy_method_name, args)


class RpcProxy:
    def __init__(self, peer, proxyId: str, proxyConstructorName: str, proxyProps: any, proxyOneWayMethods: list[str]):
        self.__proxy_id = proxyId
        self.__proxy_constructor = proxyConstructorName
        self.__proxy_peer = peer
        self.__proxy_props = proxyProps
        self.__proxy_oneway_methods = proxyOneWayMethods

    def __getattr__(self, name):
        if self.__proxy_props and hasattr(self.__proxy_props, name):
            return self.__proxy_props[name]
        return RpcProxyMethod(self, name)

    def __call__(self, *args, **kwargs):
        print('call')
        pass

    def __apply__(self, method: str, args: list):
        return self.__proxy_peer.__apply__(self.__proxy_id, self.__proxy_oneway_methods, method, args)


class RpcPeer:
    idCounter = 1
    peerName = 'Unnamed Peer'
    params: Mapping[str, any] = {}
    localProxied: Mapping[any, str] = {}
    localProxyMap: Mapping[str, any] = {}
    constructorSerializerMap = {}
    proxyCounter = 1
    pendingResults: Mapping[str, Future] = {}
    remoteWeakProxies: Mapping[str, any] = {}
    nameDeserializerMap: Mapping[str, RpcSerializer]

    def __init__(self, send: Callable[[object, Callable[[Exception], None]], None]) -> None:
        self.send = send

    def __apply__(self, proxyId: str, oneWayMethods: list[str], method: str, argArray: list):
        args = []
        for arg in argArray:
            args.append(self.serialize(arg, False))

        rpcApply = {
            'type': 'apply',
            'id': None,
            'proxyId': proxyId,
            'argArray': args,
            'method': method,
        }

        if oneWayMethods and method in oneWayMethods:
            rpcApply['oneway'] = True
            self.send(rpcApply, None)
            future = Future()
            future.set_result(None)
            return future

        async def send(id: str, reject: Callable[[Exception], None]):
            rpcApply['id'] = id
            await self.send(rpcApply, reject)
        return self.createPendingResult(send)

    def kill(self):
        self.killed = True

    def createErrorResult(self, result: any, name: str, message: str, tb: str):
        pass

    def serialize(self, value, requireProxy):
        if (not value or (not requireProxy and type(value) in jsonSerializable)):
            return value
        __remote_constructor_name = 'Function' if callable(value) else value.__proxy_constructor if hasattr(
            value, '__proxy_constructor') else type(value).__name__
        proxyId = self.localProxied.get(value, None)
        if proxyId:
            ret = {
                '__remote_proxy_id': proxyId,
                '__remote_constructor_name': __remote_constructor_name,
                '__remote_proxy_props': getattr(value, '__proxy_props', None),
                '__remote_proxy_oneway_methods': getattr(value, '__proxy_oneway_methods', None),
            }
            return ret

        __proxy_id = getattr(value, '__proxy_id', None)
        __proxy_peer = getattr(value, '__proxy_peer', None)
        if __proxy_id and __proxy_peer == self:
            ret = {
                '__local_proxy_id': __proxy_id,
            }
            return ret

        serializerMapName = self.constructorSerializerMap.get(
            type(value).__name__)
        if serializerMapName:
            __remote_constructor_name = serializerMapName
            serializer = self.nameDeserializerMap.get(serializerMapName, None)
            serialized = serializer.serialize(value)
            if not serialized or (not requireProxy and type(serialized).__name in jsonSerializable):
                ret = {
                    '__remote_proxy_id': None,
                    '__remote_constructor_name': __remote_constructor_name,
                    '__remote_proxy_props': getattr(value, '__proxy_props', None),
                    '__remote_proxy_oneway_methods': getattr(value, '__proxy_oneway_methods', None),
                    '__serialized_value': value,
                }
                return ret

        proxyId = str(self.proxyCounter)
        self.proxyCounter = self.proxyCounter + 1
        self.localProxied[value] = proxyId
        self.localProxyMap[proxyId] = value

        ret = {
            '__remote_proxy_id': proxyId,
            '__remote_constructor_name': __remote_constructor_name,
            '__remote_proxy_props': getattr(value, '__proxy_props', None),
            '__remote_proxy_oneway_methods': getattr(value, '__proxy_oneway_methods', None),
        }

        return ret

    def finalize(self, id: str):
        pass

    def newProxy(self, proxyId: str, proxyConstructorName: str, proxyProps: any, proxyOneWayMethods: list[str]):
        proxy = RpcProxy(self, proxyId, proxyConstructorName,
                         proxyProps, proxyOneWayMethods)
        wr = weakref.ref(proxy)
        self.remoteWeakProxies[proxyId] = wr
        weakref.finalize(proxy, lambda: self.finalize(proxyId))
        return proxy

    def deserialize(self, value):
        if not value:
            return value

        if type(value) != dict:
            return value

        __remote_proxy_id = value.get('__remote_proxy_id', None)
        __local_proxy_id = value.get('__local_proxy_id', None)
        __remote_constructor_name = value.get(
            '__remote_constructor_name', None)
        __serialized_value = value.get('__serialized_value', None)
        __remote_proxy_props = value.get('__remote_proxy_props', None)
        __remote_proxy_oneway_methods = value.get(
            '__remote_proxy_oneway_methods', None)

        if __remote_proxy_id:
            weakref = self.remoteWeakProxies.get('__remote_proxy_id', None)
            proxy = weakref() if weakref else None
            if not proxy:
                proxy = self.newProxy(__remote_proxy_id, __remote_constructor_name,
                                      __remote_proxy_props, __remote_proxy_oneway_methods)
            return proxy

        if __local_proxy_id:
            ret = self.localProxyMap.get(__local_proxy_id, None)
            if not ret:
                raise RpcResultException(
                    None, 'invalid local proxy id %s' % __local_proxy_id)
            return ret

        deserializer = self.nameDeserializerMap.get(
            __remote_constructor_name, None)
        if deserializer:
            return deserializer.deserialize(__serialized_value)

        return value

    async def handleMessage(self, message: any):
        try:
            type = message['type']
            match type:
                case 'param':
                    result = {
                        'type': 'result',
                        'id': message['id'],
                    }

                    try:
                        value = self.params.get(message['param'], None)
                        value = await maybe_await(value)
                        result['result'] = self.serialize(
                            value, message.get('requireProxy', None))
                    except Exception as e:
                        tb = traceback.format_exc()
                        self.createErrorResult(
                            result, type(e).__name, str(e), tb)

                    await self.send(result, None)

                case 'apply':
                    result = {
                        'type': 'result',
                        'id': message['id'],
                    }
                    method = message.get('method', None)

                    try:
                        target = self.localProxyMap.get(
                            message['proxyId'], None)
                        if not target:
                            raise Exception('proxy id %s not found' %
                                            message['proxyId'])

                        args = []
                        for arg in (message['argArray'] or []):
                            args.append(self.deserialize(arg))

                        value = None
                        if method:
                            if not hasattr(target, method):
                                raise Exception(
                                    'target %s does not have method %s' % (type(target), method))
                            value = await maybe_await(target[method](*args))
                        else:
                            value = await maybe_await(target(*args))

                        result['result'] = self.serialize(value, False)
                    except Exception as e:
                        print('failure', method, e)
                        self.createErrorResult(result, e)

                    if message.get('oneway', False):
                        self.send(result)

                case 'result':
                    future = self.pendingResults.get(message['id'], None)
                    if not future:
                        raise RpcResultException(
                            None, 'unknown result %s' % message['id'])
                    del message['id']
                    if hasattr(message, 'message') or hasattr(message, 'stack'):
                        e = RpcResultException(
                            None, message.get('message', None))
                        e.stack = message.get('stack', None)
                        e.name = message.get('name', None)
                        future.set_exception(e)
                        return
                    future.set_result(self.deserialize(
                        message.get('result', None)))
                case 'finalize':
                    local = self.localProxyMap.pop(
                        message['__local_proxy_id'], None)
                    self.localProxied.pop(local, None)
                case _:
                    raise RpcResultException(
                        None, 'unknown rpc message type %s' % type)
        except Exception as e:
            print("unhandled rpc error", self.peerName, e)
            pass

    async def createPendingResult(self, cb: Callable[[str, Callable[[Exception], None]], None]):
        # if (Object.isFrozen(this.pendingResults))
        #     return Promise.reject(new RPCResultError('RpcPeer has been killed'));

        id = str(self.idCounter)
        self.idCounter = self.idCounter + 1
        future = Future()
        self.pendingResults[id] = future
        await cb(id, lambda e: future.set_exception(RpcResultException(e, None)))
        return await future

    async def getParam(self, param):
        async def send(id: str, reject: Callable[[Exception], None]):
            paramMessage = {
                'id': id,
                'type': 'param',
                'param': param,
            }
            await self.send(paramMessage, reject)
        return await self.createPendingResult(send)

# c = RpcPeer()


async def readLoop(loop, peer, reader):
    async for line in reader:
        try:
            message = json.loads(line)
            asyncio.run_coroutine_threadsafe(peer.handleMessage(message), loop)
        except Exception as e:
            print('read loop error', e)
            pass


async def main(loop: AbstractEventLoop):
    reader, writer = await asyncio.open_connection(
        '127.0.0.1', 3033)

    async def send(message, reject):
        jsonString = json.dumps(message)
        writer.write(bytes(jsonString + '\n', 'utf8'))
        try:
            await writer.drain()
        except Exception as e:
            if reject:
                reject(e)

    peer = RpcPeer(send)
    peer.params['print'] = print

    async def consoleTest():
        console = await peer.getParam('console')
        await console.log('test', 'poops', 'peddeps')

    await asyncio.gather(readLoop(loop, peer, reader), consoleTest())
    print('done')

    # print("line %s" % line)

    # async with aiofiles.open(0, mode='r') as f:
    #     async for line in f:
    #         print("line %s" % line)
    # # pokemon = json.loads(contents)
    # # print(pokemon['name'])

loop = asyncio.get_event_loop()
loop.run_until_complete(main(loop))
loop.close()
