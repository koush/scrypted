import { once } from 'events';
import net from 'net';
import os from 'os';
import worker_threads from 'worker_threads';
import { Deferred } from '../deferred';
import { listenZero } from '../listen-zero';
import { NodeThreadWorker } from '../plugin/runtime/node-thread-worker';
import { RpcPeer } from "../rpc";
import { createDuplexRpcPeer } from "../rpc-serializer";
import { computeClusterObjectHash } from "./cluster-hash";
import { ClusterObject, ConnectRPCObject } from "./connect-rpc-object";

function getClusterPeerKey(address: string, port: number) {
    return `${address}:${port}`;
}

export function isClusterAddress(address: string) {
    return !address || address === process.env.SCRYPTED_CLUSTER_ADDRESS;
}

export function getClusterObject(clusterId: string, value: any) {
    const clusterObject: ClusterObject = value?.__cluster;
    if (clusterObject?.id !== clusterId)
        return;
    return clusterObject;
}

async function peerConnectRPCObject(peer: RpcPeer, o: ClusterObject) {
    let peerConnectRPCObject: Promise<ConnectRPCObject> = peer.tags['connectRPCObject'];
    if (!peerConnectRPCObject) {
        peerConnectRPCObject = peer.getParam('connectRPCObject');
        peer.tags['connectRPCObject'] = peerConnectRPCObject;
    }
    const resolved = await peerConnectRPCObject;
    return resolved(o);
}

export function setupCluster(peer: RpcPeer) {
    const SCRYPTED_CLUSTER_ADDRESS = process.env.SCRYPTED_CLUSTER_ADDRESS;
    let clusterId: string;
    let clusterSecret: string;
    let clusterPort: number;
    let clusterWorkerId: string;

    // all cluster clients, incoming and outgoing, connect with random ports which can be used as peer ids
    // on the cluster server that is listening on the actual port.
    // incoming connections: use the remote random/unique port
    // outgoing connections: use the local random/unique port
    const clusterPeers = new Map<string, Promise<RpcPeer>>();

    peer.killedSafe.finally(() => {
        for (const cp of clusterPeers.values()) {
            cp.then(c => c.kill()).catch(() => { });
        }
    });

    const resolveObject = async (id: string, sourceKey: string) => {
        const sourcePeer = sourceKey
            ? await clusterPeers.get(sourceKey)
            : peer;
        if (!sourcePeer)
            console.error('source peer not found', sourceKey);
        const ret = sourcePeer?.localProxyMap.get(id);
        if (!ret) {
            console.error('source key not found', sourceKey, id);
            return;
        }
        return ret;
    }

    const connectClusterObject = async (o: ClusterObject) => {
        const sha256 = computeClusterObjectHash(o, clusterSecret);
        if (sha256 !== o.sha256)
            throw new Error('secret incorrect');
        return resolveObject(o.proxyId, o.sourceKey);
    }

    const ensureClusterPeer = (address: string, connectPort: number) => {
        if (isClusterAddress(address))
            address = '127.0.0.1';

        const clusterPeerKey = getClusterPeerKey(address, connectPort);
        let clusterPeerPromise = clusterPeers.get(clusterPeerKey);
        if (clusterPeerPromise)
            return clusterPeerPromise;

        clusterPeerPromise = (async () => {
            const socket = net.connect(connectPort, address);
            socket.on('close', () => clusterPeers.delete(clusterPeerKey));

            try {
                await once(socket, 'connect');
                const { address: sourceAddress } = (socket.address() as net.AddressInfo);
                if (sourceAddress !== SCRYPTED_CLUSTER_ADDRESS && sourceAddress !== '127.0.0.1') {
                    // source address may end with .0 if its a gateway into docker.
                    if (!sourceAddress.endsWith('.0'))
                        console.warn("source address mismatch", sourceAddress);
                }

                const clusterPeer = createDuplexRpcPeer(peer.selfName, clusterPeerKey, socket, socket);
                // set params from the primary peer, needed for get getRemote in cluster mode.
                Object.assign(clusterPeer.params, peer.params);
                clusterPeer.onProxySerialization = (value) => onProxySerialization(clusterPeer, value, clusterPeerKey);
                return clusterPeer;
            }
            catch (e) {
                console.error('failure ipc connect', e);
                socket.destroy();
                throw e;
            }
        })();

        clusterPeers.set(clusterPeerKey, clusterPeerPromise);
        return clusterPeerPromise;
    };


    const tidChannels = new Map<number, Deferred<worker_threads.MessagePort>>();
    const tidPeers = new Map<number, Promise<RpcPeer>>();

    peer.killedSafe.finally(() => {
        for (const cp of tidPeers.values()) {
            cp.then(c => c.kill()).catch(() => { });
        }
    });

    function connectTidPeer(tid: number) {
        let peerPromise = tidPeers.get(tid);
        if (peerPromise)
            return peerPromise;
        let tidDeferred = tidChannels.get(tid);
        // if the tid port is not available yet, request it.
        if (!tidDeferred) {
            tidDeferred = new Deferred<worker_threads.MessagePort>();
            tidChannels.set(tid, tidDeferred);

            if (mainThreadPort) {
                // request the connection via the main thread
                mainThreadPort.postMessage({
                    threadId: tid,
                });
            }
        }

        const threadPeerKey = `thread:${tid}`;
        function peerCleanup() {
            clusterPeers.delete(threadPeerKey);
        }
        peerPromise = tidDeferred.promise.then(port => {
            const threadPeer = NodeThreadWorker.createRpcPeer(peer.selfName, threadPeerKey, port);
            // set params from the primary peer, needed for get getRemote in cluster mode.
            Object.assign(threadPeer.params, peer.params);
            threadPeer.onProxySerialization = value => onProxySerialization(threadPeer, value, threadPeerKey);

            threadPeer.params.connectRPCObject = connectClusterObject;

            function cleanup(message: string) {
                peerCleanup();
                tidChannels.delete(tid);
                tidPeers.delete(tid);
                threadPeer.kill(message);
            }
            port.on('close', () => cleanup('connection closed.'));
            port.on('messageerror', () => cleanup('message error.'));
            return threadPeer;
        });
        peerPromise.catch(() => peerCleanup());
        clusterPeers.set(threadPeerKey, peerPromise);
        tidPeers.set(tid, peerPromise);

        return peerPromise;
    }

    const mainThreadPort: worker_threads.MessagePort = worker_threads.isMainThread ? undefined : worker_threads.workerData.mainThreadPort;
    if (!worker_threads.isMainThread) {
        // the main thread port will send messages with a thread port when a thread wants to initiate a connection.
        mainThreadPort.on('message', async (message: { port: worker_threads.MessagePort, threadId: number }) => {
            const { port, threadId } = message;
            let tidDeferred = tidChannels.get(threadId);
            if (!tidDeferred) {
                tidDeferred = new Deferred<worker_threads.MessagePort>();
                tidChannels.set(threadId, tidDeferred);
            }
            tidDeferred.resolve(port);
            connectTidPeer(threadId);
        });
    }

    async function connectIPCObject(clusterObject: ClusterObject, tid: number) {
        // if the main thread is trying to connect to an object,
        // the argument order matters here, as the connection attempt looks at the
        // connectThreadId to see if the target is main thread.
        if (worker_threads.isMainThread)
            mainThreadBrokerConnect(tid, worker_threads.threadId);
        const clusterPeer = await connectTidPeer(tid);
        const existing = clusterPeer.remoteWeakProxies[clusterObject.proxyId]?.deref();
        if (existing)
            return existing;
        return peerConnectRPCObject(clusterPeer, clusterObject);
    }

    const brokeredConnections = new Set<string>();
    const workers = new Map<number, worker_threads.MessagePort>();
    function mainThreadBrokerConnect(threadId: number, connectThreadId: number) {
        if (worker_threads.isMainThread && threadId === worker_threads.threadId) {
            const msg = 'invalid ipc, main thread cannot connect to itself';
            console.error(msg);
            throw new Error(msg);
        }
        // both workers nay initiate connection to each other at same time, so this
        // is a synchronization point.
        const key = JSON.stringify([threadId, connectThreadId].sort());
        if (brokeredConnections.has(key))
            return;

        brokeredConnections.add(key);

        const worker = workers.get(threadId);
        const connect = workers.get(connectThreadId);
        const channel = new worker_threads.MessageChannel();

        worker.postMessage({
            port: channel.port1,
            threadId: connectThreadId,
        }, [channel.port1]);

        if (connect) {
            connect.postMessage({
                port: channel.port2,
                threadId,
            }, [channel.port2]);
        }
        else if (connectThreadId === worker_threads.threadId) {
            connectTidPeer(threadId);
            const deferred = tidChannels.get(threadId);
            deferred.resolve(channel.port2);
        }
        else {
            channel.port2.close();
        }
    }

    function mainThreadBrokerRegister(workerPort: worker_threads.MessagePort, threadId: number) {
        workers.set(threadId, workerPort);

        // this is main thread, so there will be two types of requests from the child: registration requests from grandchildren and connection requests.
        workerPort.on('message', async (message: { port: worker_threads.MessagePort, threadId: number }) => {
            const { port, threadId: connectThreadId } = message;

            if (port) {
                mainThreadBrokerRegister(port, connectThreadId);
            }
            else {
                mainThreadBrokerConnect(threadId, connectThreadId);
            }
        });
    }

    const connectRPCObject = async (value: any) => {
        const clusterObject = getClusterObject(clusterId, value);
        if (!clusterObject)
            return value;
        const { address, port, proxyId } = clusterObject;
        // handle the case when trying to connect to an object is on this cluster node,
        // returning the actual object, rather than initiating a loopback connection.
        if (port === clusterPort)
            return connectClusterObject(clusterObject);

        // can use worker to worker ipc if the address and pid matches and both side are node.
        if (address === SCRYPTED_CLUSTER_ADDRESS && proxyId.startsWith('n-')) {
            const parts = proxyId.split('-');
            const pid = parseInt(parts[1]);
            const tid = parseInt(parts[2]);
            if (pid === process.pid) {
                if (worker_threads.isMainThread && tid === worker_threads.threadId) {
                    // main thread can't call itself, so this may be a different thread cluster.
                }
                else {
                    return connectIPCObject(clusterObject, parseInt(parts[2]));
                }
            }
        }

        try {
            const clusterPeerPromise = ensureClusterPeer(address, port);
            const clusterPeer = await clusterPeerPromise;
            // may already have this proxy so check first.
            const existing = clusterPeer.remoteWeakProxies[proxyId]?.deref();
            if (existing)
                return existing;
            const newValue = await peerConnectRPCObject(clusterPeer, clusterObject);
            if (!newValue)
                throw new Error('rpc object not found?');
            return newValue;
        }
        catch (e) {
            console.error('failure rpc', clusterObject, e);
            return value;
        }
    }

    const onProxySerialization = (peer: RpcPeer, value: any, sourceKey: string) => {
        const properties = RpcPeer.prepareProxyProperties(value) || {};
        let clusterEntry: ClusterObject = properties.__cluster;

        // ensure globally stable proxyIds.
        // worker threads will embed their pid and tid in the proxy id for cross worker fast path.
        const proxyId = peer.localProxied.get(value)?.id || clusterEntry?.proxyId || `n-${process.pid}-${worker_threads.threadId}-${RpcPeer.generateId()}`;

        // if the cluster entry already exists, check if it belongs to this node.
        // if it belongs to this node, the entry must also be for this peer.
        // relying on the liveness/gc of a different peer may cause race conditions.
        if (clusterEntry) {
            if (isClusterAddress(clusterEntry?.address) && clusterPort === clusterEntry.port && sourceKey !== clusterEntry.sourceKey)
                clusterEntry = undefined;
        }

        if (!clusterEntry) {
            clusterEntry = {
                id: clusterId,
                address: SCRYPTED_CLUSTER_ADDRESS,
                port: clusterPort,
                proxyId,
                sourceKey,
                sha256: null,
            };
            clusterEntry.sha256 = computeClusterObjectHash(clusterEntry, clusterSecret);
            properties.__cluster = clusterEntry;
        }

        return {
            proxyId,
            properties,
        };
    }
    const initializeCluster: InitializeCluster = async (options: {
        clusterId: string;
        clusterSecret: string;
        clusterWorkerId: string;
    }) => {
        if (clusterPort)
            return;

        ({ clusterId, clusterSecret, clusterWorkerId, } = options);

        const clients = new Set<net.Socket>();


        const { server: clusterRpcServer, port } = await clusterListenZero(client => {
            const clusterPeerAddress = client.remoteAddress;
            const clusterPeerPort = client.remotePort;
            const clusterPeerKey = getClusterPeerKey(clusterPeerAddress, clusterPeerPort);
            const clusterPeer = createDuplexRpcPeer(peer.selfName, clusterPeerKey, client, client);
            // set params from the primary peer, needed for get getRemote in cluster mode.
            Object.assign(clusterPeer.params, peer.params);
            // the listening peer sourceKey (client address/port) is used by the OTHER peer (the client)
            // to determine if it is already connected to THIS peer (the server).
            clusterPeer.onProxySerialization = (value) => onProxySerialization(clusterPeer, value, clusterPeerKey);
            clusterPeers.set(clusterPeerKey, Promise.resolve(clusterPeer));
            clusterPeer.params.connectRPCObject = connectClusterObject;
            client.on('close', () => {
                clusterPeers.delete(clusterPeerKey);
                clusterPeer.kill('cluster socket closed');
                clients.delete(client);
            });
            clients.add(client);
        });

        clusterPort = port;

        peer.onProxySerialization = value => onProxySerialization(peer, value, undefined);
        delete peer.params.initializeCluster;

        peer.killedSafe.finally(() => clusterRpcServer.close());
        clusterRpcServer.on('close', () => {
            peer.kill('cluster server closed');
            // close all clusterRpcServer clients
            for (const client of clients) {
                client.destroy();
            }
            clients.clear();
        });
    }

    return {
        initializeCluster,
        get clusterPort() {
            return clusterPort;
        },
        SCRYPTED_CLUSTER_ADDRESS,
        clusterPeers,
        onProxySerialization,
        connectClusterObject,
        ensureClusterPeer,
        mainThreadPort,
        mainThreadBrokerRegister,
        connectRPCObject,
    }
}

export type InitializeCluster = (cluster: { clusterId: string, clusterSecret: string, clusterWorkerId: string, }) => Promise<void>;

export function getScryptedClusterMode(): ['server' | 'client', string, number] {
    const mode = process.env.SCRYPTED_CLUSTER_MODE as 'server' | 'client';

    if (!mode) {
        if (process.env.SCRYPTED_CLUSTER_ADDRESS) {
            console.warn('SCRYPTED_CLUSTER_ADDRESS is set but SCRYPTED_CLUSTER_MODE is not set. This setting will be ignored.');
            delete process.env.SCRYPTED_CLUSTER_ADDRESS;
        }
        if (process.env.SCRPYTED_CLUSTER_SERVER) {
            console.warn('SCRYPTED_CLUSTER_SERVER is set but SCRYPTED_CLUSTER_MODE is not set. This setting will be ignored.');
            delete process.env.SCRPYTED_CLUSTER_SERVER
        }
        if (process.env.SCRYPTED_CLUSTER_SECRET) {
            console.warn('SCRYPTED_CLUSTER_SECRET is set but SCRYPTED_CLUSTER_MODE is not set. This setting will be ignored.');
            delete process.env.SCRYPTED_CLUSTER_SECRET;
        }
        return;
    }

    if (!['server', 'client'].includes(mode))
        throw new Error('SCRYPTED_CLUSTER_MODE must be set to either "server" or "client".');

    if (!process.env.SCRYPTED_CLUSTER_SECRET)
        throw new Error('SCRYPTED_CLUSTER_MODE is set but SCRYPTED_CLUSTER_SECRET is not set.');

    const [server, sport] = process.env.SCRYPTED_CLUSTER_SERVER?.split(':') || [];
    const port = parseInt(sport) || 10556;
    const address = process.env.SCRYPTED_CLUSTER_ADDRESS;

    if (mode === 'client') {
        // server may be a hostname so no IP check is necessary
        if (!server)
            throw new Error('SCRYPTED_CLUSTER_SERVER is not a valid IP address:port.');

        // the address can be determined by checking the socket.localAddress after connection.
        // if (!net.isIP(address))
        //     throw new Error('SCRYPTED_CLUSTER_ADDRESS is not set to a valid IP address.');
    }
    else {
        // the cluster address may come from the server:port combo or address variable but not both.
        if (address && server && server !== address)
            throw new Error('SCRYPTED_CLUSTER_ADDRESS and SCRYPTED_CLUSTER_SERVER must not both be used.');

        let serverAddress = address || server;
        if (!net.isIP(serverAddress)) {
            // due to dhcp changes allowing an interface name for the server address is also valid,
            // resolve using network interfaces.
            const interfaces = os.networkInterfaces();
            const iface = interfaces[serverAddress];
            const ipv4 = iface?.find(i => i.family === 'IPv4');
            if (!ipv4)
                throw new Error('SCRYPTED_CLUSTER_ADDRESS is not set.');
            serverAddress = ipv4.address;
        }
        process.env.SCRYPTED_CLUSTER_ADDRESS = serverAddress;
        delete process.env.SCRYPTED_CLUSTER_SERVER;
    }

    return [mode, server, port];
}

export async function clusterListenZero(callback: (socket: net.Socket) => void) {
    const SCRYPTED_CLUSTER_ADDRESS = process.env.SCRYPTED_CLUSTER_ADDRESS;
    if (!SCRYPTED_CLUSTER_ADDRESS) {
        const server = new net.Server(callback);
        const port = await listenZero(server, '127.0.0.1');
        return {
            server,
            port,
        }
    }

    // need to listen on the cluster address and 127.0.0.1 on the same port.
    let retries = 5;
    while (retries--) {
        const server = new net.Server(callback);
        const port = await listenZero(server, SCRYPTED_CLUSTER_ADDRESS);
        try {
            const localServer = new net.Server(callback);
            localServer.listen(port, '127.0.0.1');
            await once(localServer, 'listening');
            server.on('close', () => localServer.close());
            return {
                server,
                port,
            }
        }
        catch (e) {
            // port may be in use, keep trying.
            server.close();
        }
    }

    throw new Error('failed to bind to cluster address.');
}
