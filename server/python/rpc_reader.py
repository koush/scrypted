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

async def readLoop(loop, peer: rpc.RpcPeer, reader):
    deserializationContext = {
        'buffers': []
    }

    while True:
        try:
            lengthBytes = await reader.read(4)
            typeBytes = await reader.read(1)
            type = typeBytes[0]
            length = int.from_bytes(lengthBytes, 'big')
            data = await reader.read(length - 1)

            if type == 1:
                deserializationContext['buffers'].append(data)
                continue

            message = json.loads(data)
            asyncio.run_coroutine_threadsafe(
                peer.handleMessage(message, deserializationContext), loop)

            deserializationContext = {
                'buffers': []
            }
        except Exception as e:
            print('read loop error: ' + peer.peerName, e)
            sys.exit()

async def prepare_peer_readloop(loop: AbstractEventLoop, readFd: int, writeFd: int):
    reader = await aiofiles.open(readFd, mode='rb')

    mutex = threading.Lock()

    def send(message, reject=None, serializationContext=None):
        with mutex:
            if serializationContext:
                buffers = serializationContext.get('buffers', None)
                if buffers:
                    for buffer in buffers:
                        length = len(buffer) + 1
                        lb = length.to_bytes(4, 'big')
                        type = 1
                        try:
                            os.write(writeFd, lb)
                            os.write(writeFd, bytes([type]))
                            os.write(writeFd, buffer)
                        except Exception as e:
                            if reject:
                                reject(e)
                            return

            jsonString = json.dumps(message)
            b = bytes(jsonString, 'utf8')
            length = len(b) + 1
            lb = length.to_bytes(4, 'big')
            type = 0
            try:
                os.write(writeFd, lb)
                os.write(writeFd, bytes([type]))
                os.write(writeFd, b)
            except Exception as e:
                if reject:
                    reject(e)

    peer = rpc.RpcPeer(send)
    peer.nameDeserializerMap['Buffer'] = SidebandBufferSerializer()
    peer.constructorSerializerMap[bytes] = 'Buffer'
    peer.constructorSerializerMap[bytearray] = 'Buffer'

    async def peerReadLoop():
        await readLoop(loop, peer, reader)

    return peer, peerReadLoop
