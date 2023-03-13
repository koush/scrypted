from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
import threading
from asyncio.events import AbstractEventLoop
from os import sys
from typing import List

import aiofiles
import rpc


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

async def readLoop(loop, peer: rpc.RpcPeer, reader: asyncio.StreamReader):
    deserializationContext = {
        'buffers': []
    }

    if isinstance(reader, asyncio.StreamReader):
        async def read(n):
            return await reader.readexactly(n)
    else:
        async def read(n):
            return await reader.read(n)


    while True:
        lengthBytes = await read(4)
        typeBytes = await read(1)
        type = typeBytes[0]
        length = int.from_bytes(lengthBytes, 'big')
        data = await read(length - 1)

        if type == 1:
            deserializationContext['buffers'].append(data)
            continue

        message = json.loads(data)
        asyncio.run_coroutine_threadsafe(
            peer.handleMessage(message, deserializationContext), loop)

        deserializationContext = {
            'buffers': []
        }

async def prepare_peer_readloop(loop: AbstractEventLoop, readFd: int = None, writeFd: int = None, reader: asyncio.StreamReader = None, writer: asyncio.StreamWriter = None):
    reader = reader or await aiofiles.open(readFd, mode='rb')

    mutex = threading.Lock()

    if writer:
        def write(buffers, reject):
            try:
                for b in buffers:
                    writer.write(b)
            except Exception as e:
                if reject:
                    reject(e)
            return None
    else:
        def write(buffers, reject):
            try:
                for b in buffers:
                    os.write(writeFd, b)
            except Exception as e:
                if reject:
                    reject(e)

    def send(message, reject=None, serializationContext=None):
        with mutex:
            if serializationContext:
                buffers = serializationContext.get('buffers', None)
                if buffers:
                    for buffer in buffers:
                        length = len(buffer) + 1
                        lb = length.to_bytes(4, 'big')
                        type = 1
                        write([lb, bytes([type]), buffer], reject)

            jsonString = json.dumps(message)
            b = bytes(jsonString, 'utf8')
            length = len(b) + 1
            lb = length.to_bytes(4, 'big')
            type = 0
            write([lb, bytes([type]), b], reject)

    peer = rpc.RpcPeer(send)
    peer.nameDeserializerMap['Buffer'] = SidebandBufferSerializer()
    peer.constructorSerializerMap[bytes] = 'Buffer'
    peer.constructorSerializerMap[bytearray] = 'Buffer'
    peer.constructorSerializerMap[memoryview] = 'Buffer'

    async def peerReadLoop():
        await readLoop(loop, peer, reader)

    return peer, peerReadLoop
