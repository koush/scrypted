from __future__ import annotations

import asyncio
import base64
import hashlib
import os
from asyncio.events import AbstractEventLoop
from collections.abc import Mapping
from typing import Any

import rpc
import rpc_reader
from typing import TypedDict, Callable


class ClusterObject(TypedDict):
    id: str
    address: str
    port: int
    proxyId: str
    sourceKey: str
    sha256: str


def isClusterAddress(address: str):
    return not address or address == os.environ.get("SCRYPTED_CLUSTER_ADDRESS", None)


def getClusterPeerKey(address: str, port: int):
    return f"{address}:{port}"


class ClusterSetup:
    def __init__(self, loop: AbstractEventLoop, peer: rpc.RpcPeer):
        self.loop = loop
        self.peer = peer
        self.clusterId: str = None
        self.clusterSecret: str = None
        self.clusterAddress: str = None
        self.clusterPort: int = None
        self.SCRYPTED_CLUSTER_ADDRESS: str = None
        self.clusterPeers: Mapping[str, asyncio.Future[rpc.RpcPeer]] = {}

    async def resolveObject(self, id: str, sourceKey: str):
        sourcePeer: rpc.RpcPeer = (
            self.peer
            if not sourceKey
            else await rpc.maybe_await(self.clusterPeers.get(sourceKey, None))
        )
        if not sourcePeer:
            return
        return sourcePeer.localProxyMap.get(id, None)

    async def connectClusterObject(self, o: ClusterObject):
        sha256 = self.computeClusterObjectHash(o)
        if sha256 != o["sha256"]:
            raise Exception("secret incorrect")
        return await self.resolveObject(
            o.get("proxyId", None), o.get("sourceKey", None)
        )

    def onProxySerialization(
        self, peer: rpc.RpcPeer, value: Any, sourceKey: str = None
    ):
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
                and self.clusterPort == clusterEntry["port"]
                and sourceKey != clusterEntry.get("sourceKey", None)
            ):
                clusterEntry = None

        if not clusterEntry:
            clusterEntry: ClusterObject = {
                "id": self.clusterId,
                "proxyId": proxyId,
                "address": self.SCRYPTED_CLUSTER_ADDRESS,
                "port": self.clusterPort,
                "sourceKey": sourceKey,
            }
            clusterEntry["sha256"] = self.computeClusterObjectHash(clusterEntry)
            properties["__cluster"] = clusterEntry

        return proxyId, properties

    async def initializeCluster(self, options: dict):
        if self.clusterPort:
            return
        self.clusterId = options["clusterId"]
        self.clusterSecret = options["clusterSecret"]
        self.clusterWorkerId = options.get("clusterWorkerId", None)
        self.SCRYPTED_CLUSTER_ADDRESS = os.environ.get("SCRYPTED_CLUSTER_ADDRESS", None)

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
            # set all params from self.peer
            for key, value in self.peer.params.items():
                peer.params[key] = value
            peer.onProxySerialization = lambda value: self.onProxySerialization(
                peer, value, clusterPeerKey
            )
            future: asyncio.Future[rpc.RpcPeer] = asyncio.Future()
            future.set_result(peer)
            self.clusterPeers[clusterPeerKey] = future
            peer.params["connectRPCObject"] = lambda o: self.connectClusterObject(o)
            try:
                await peerReadLoop()
            except:
                pass
            finally:
                self.clusterPeers.pop(clusterPeerKey)
                peer.kill("cluster client killed")
                writer.close()

        clusterRpcServerInfo = await cluster_listen_zero(handleClusterClient)
        self.clusterPort = clusterRpcServerInfo["port"]
        self.peer.onProxySerialization = lambda value: self.onProxySerialization(
            self.peer, value, None
        )
        del self.peer.params["initializeCluster"]

    def computeClusterObjectHash(self, o: ClusterObject) -> str:
        m = hashlib.sha256()
        m.update(
            bytes(
                # The use of ` o.get(key, None) or '' ` is to ensure that optional fields
                # are omitted from the hash, matching the JS implementation. Otherwise, since
                # the dict may contain the keys initialized to None, ` o.get(key, '') ` would
                # return None instead of ''.
                f"{o['id']}{o.get('address', None) or ''}{o['port']}{o.get('sourceKey', None) or ''}{o['proxyId']}{self.clusterSecret}",
                "utf8",
            )
        )
        return base64.b64encode(m.digest()).decode("utf-8")

    def ensureClusterPeer(self, address: str, port: int):
        if isClusterAddress(address):
            address = "127.0.0.1"
        clusterPeerKey = getClusterPeerKey(address, port)
        clusterPeerPromise = self.clusterPeers.get(clusterPeerKey)
        if clusterPeerPromise:
            return clusterPeerPromise

        async def connectClusterPeer():
            try:
                reader, writer = await asyncio.open_connection(address, port)
                sourceAddress, sourcePort = writer.get_extra_info("sockname")
                if (
                    sourceAddress != self.SCRYPTED_CLUSTER_ADDRESS
                    and sourceAddress != "127.0.0.1"
                ):
                    print("source address mismatch", sourceAddress)
                rpcTransport = rpc_reader.RpcStreamTransport(reader, writer)
                clusterPeer, peerReadLoop = await rpc_reader.prepare_peer_readloop(
                    self.loop, rpcTransport
                )
                # set all params from self.peer
                for key, value in self.peer.params.items():
                    clusterPeer.params[key] = value
                clusterPeer.onProxySerialization = (
                    lambda value: self.onProxySerialization(
                        clusterPeer, value, clusterPeerKey
                    )
                )
            except:
                self.clusterPeers.pop(clusterPeerKey)
                raise

            async def run_loop():
                try:
                    await peerReadLoop()
                except:
                    pass
                finally:
                    self.clusterPeers.pop(clusterPeerKey)

            asyncio.run_coroutine_threadsafe(run_loop(), self.loop)
            return clusterPeer

        clusterPeerPromise = self.loop.create_task(connectClusterPeer())

        self.clusterPeers[clusterPeerKey] = clusterPeerPromise
        return clusterPeerPromise

    async def connectRPCObject(self, value):
        __cluster = getattr(value, "__cluster")
        if type(__cluster) is not dict:
            return value

        clusterObject: ClusterObject = __cluster

        if clusterObject.get("id", None) != self.clusterId:
            return value

        address = clusterObject.get("address", None)
        port = clusterObject["port"]
        proxyId = clusterObject["proxyId"]
        if port == self.clusterPort:
            return await self.connectRPCObject(clusterObject)

        clusterPeerPromise = self.ensureClusterPeer(address, port)

        try:
            clusterPeer = await clusterPeerPromise
            weakref = clusterPeer.remoteWeakProxies.get(proxyId, None)
            existing = weakref() if weakref else None
            if existing:
                return existing

            peerConnectRPCObject = clusterPeer.tags.get("connectRPCObject")
            if not peerConnectRPCObject:
                peerConnectRPCObject = await clusterPeer.getParam("connectRPCObject")
                clusterPeer.tags["connectRPCObject"] = peerConnectRPCObject
            newValue = await peerConnectRPCObject(clusterObject)
            if not newValue:
                raise Exception("rpc object not found?")
            return newValue
        except Exception as e:
            return value


class ClusterServerListener(TypedDict):
    server: asyncio.Server
    port: int


async def cluster_listen_zero(
    callback: Callable[[asyncio.StreamReader, asyncio.StreamWriter]]
) -> ClusterServerListener:
    SCRYPTED_CLUSTER_ADDRESS = os.getenv("SCRYPTED_CLUSTER_ADDRESS")
    if not SCRYPTED_CLUSTER_ADDRESS:
        server = await asyncio.start_server(callback, host=None, port=0)
        port = server.sockets[0].getsockname()[1]
        return {
            "server": server,
            "port": port,
        }

    # need to listen on the cluster address and 127.0.0.1 on the same port.
    retries = 5
    while retries > 0:
        cluster_server = await asyncio.start_server(
            callback, host=SCRYPTED_CLUSTER_ADDRESS, port=0
        )
        port = cluster_server.sockets[0].getsockname()[1]

        try:
            print('trying to bind to port', port)
            local_server = await asyncio.start_server(
                callback, host="127.0.0.1", port=port
            )

            future = asyncio.ensure_future(local_server.wait_closed())
            future.add_done_callback(lambda: local_server.close())

            return {
                "server": cluster_server,
                "port": port,
            }
        except:
            # Port may be in use, keep trying.
            cluster_server.close()
            retries -= 1

    raise Exception("failed to bind to cluster address.")
