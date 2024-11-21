from __future__ import annotations

import asyncio
import base64
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from asyncio.events import AbstractEventLoop
from typing import List, Any
import multiprocessing.connection
import rpc
import concurrent.futures
import json


class BufferSerializer(rpc.RpcSerializer):
    def serialize(self, value, serializationContext):
        return base64.b64encode(value).decode("utf8")

    def deserialize(self, value, serializationContext):
        return base64.b64decode(value)


class SidebandBufferSerializer(rpc.RpcSerializer):
    def serialize(self, value, serializationContext):
        buffers = serializationContext.get("buffers", None)
        if not buffers:
            buffers = []
            serializationContext["buffers"] = buffers
        buffers.append(value)
        return len(buffers) - 1

    def deserialize(self, value, serializationContext):
        buffers: List = serializationContext.get("buffers", None)
        buffer = buffers.pop()
        return buffer


class RpcTransport:
    async def prepare(self):
        pass

    async def read(self):
        pass

    def writeBuffer(self, buffer, reject):
        pass

    def writeJSON(self, json, reject):
        pass


class RpcFileTransport(RpcTransport):
    def __init__(self, readFd: int, writeFd: int) -> None:
        super().__init__()
        self.readFd = readFd
        self.writeFd = writeFd
        self.executor = ThreadPoolExecutor(1, "rpc-read")

    def osReadExact(self, size: int):
        b = bytes(0)
        while size:
            got = os.read(self.readFd, size)
            if not len(got):
                self.executor.shutdown(False)
                raise Exception("rpc end of stream reached")
            size -= len(got)
            b += got
        return b

    def readMessageInternal(self):
        lengthBytes = self.osReadExact(4)
        typeBytes = self.osReadExact(1)
        type = typeBytes[0]
        length = int.from_bytes(lengthBytes, "big")
        data = self.osReadExact(length - 1)
        if type == 1:
            return data
        message = json.loads(data)
        return message

    async def read(self):
        return await asyncio.get_event_loop().run_in_executor(
            self.executor, lambda: self.readMessageInternal()
        )

    def writeMessage(self, type: int, buffer, reject):
        length = len(buffer) + 1
        lb = length.to_bytes(4, "big")
        try:
            for b in [lb, bytes([type]), buffer]:
                os.write(self.writeFd, b)
        except Exception as e:
            if reject:
                reject(e)

    def writeJSON(self, j, reject):
        return self.writeMessage(
            0, bytes(json.dumps(j, allow_nan=False), "utf8"), reject
        )

    def writeBuffer(self, buffer, reject):
        return self.writeMessage(1, buffer, reject)


class RpcStreamTransport(RpcTransport):
    def __init__(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        super().__init__()
        self.reader = reader
        self.writer = writer

    async def read(self):
        lengthBytes = await self.reader.readexactly(4)
        typeBytes = await self.reader.readexactly(1)
        type = typeBytes[0]
        length = int.from_bytes(lengthBytes, "big")
        data = await self.reader.readexactly(length - 1)
        if type == 1:
            return data
        message = json.loads(data)
        return message

    def writeMessage(self, type: int, buffer, reject):
        length = len(buffer) + 1
        lb = length.to_bytes(4, "big")
        try:
            for b in [lb, bytes([type]), buffer]:
                self.writer.write(b)
        except Exception as e:
            if reject:
                reject(e)

    def writeJSON(self, j, reject):
        return self.writeMessage(
            0, bytes(json.dumps(j, allow_nan=False), "utf8"), reject
        )

    def writeBuffer(self, buffer, reject):
        return self.writeMessage(1, buffer, reject)


class RpcConnectionTransport(RpcTransport):
    def __init__(self, connection: multiprocessing.connection.Connection) -> None:
        super().__init__()
        self.connection = connection
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)

    async def read(self):
        return await asyncio.get_event_loop().run_in_executor(
            self.executor, lambda: self.connection.recv()
        )

    def writeMessage(self, json, reject):
        try:
            self.connection.send(json)
        except Exception as e:
            if reject:
                reject(e)

    def writeJSON(self, json, reject):
        return self.writeMessage(json, reject)

    def writeBuffer(self, buffer, reject):
        return self.writeMessage(bytes(buffer), reject)


async def readLoop(loop, peer: rpc.RpcPeer, rpcTransport: RpcTransport):
    deserializationContext = {"buffers": []}

    while True:
        message = await rpcTransport.read()

        if type(message) != dict:
            deserializationContext["buffers"].append(message)
            continue

        asyncio.run_coroutine_threadsafe(
            peer.handleMessage(message, deserializationContext), loop
        )

        deserializationContext = {"buffers": []}


async def prepare_peer_readloop(loop: AbstractEventLoop, rpcTransport: RpcTransport):
    await rpcTransport.prepare()

    mutex = threading.Lock()

    def send(message, reject=None, serializationContext=None):
        with mutex:
            if serializationContext:
                buffers = serializationContext.get("buffers", None)
                if buffers:
                    for buffer in buffers:
                        rpcTransport.writeBuffer(buffer, reject)

            rpcTransport.writeJSON(message, reject)

    peer = rpc.RpcPeer(send)
    peer.nameDeserializerMap["Buffer"] = SidebandBufferSerializer()
    peer.constructorSerializerMap[bytes] = "Buffer"
    peer.constructorSerializerMap[bytearray] = "Buffer"
    peer.constructorSerializerMap[memoryview] = "Buffer"

    async def peerReadLoop():
        try:
            await readLoop(loop, peer, rpcTransport)
        except:
            peer.kill()
            raise

    return peer, peerReadLoop
