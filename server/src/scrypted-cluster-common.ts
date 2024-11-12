import net from 'net';
import { computeClusterObjectHash } from "./cluster/cluster-hash";
import { ClusterObject } from "./cluster/connect-rpc-object";
import { RpcPeer } from "./rpc";
import { createDuplexRpcPeer } from "./rpc-serializer";
import { InitializeCluster } from "./scrypted-cluster";
import worker_threads from 'worker_threads';
import { listenZero } from './listen-zero';

export function getClusterPeerKey(address: string, port: number) {
    return `${address}:${port}`;
}

export function prepareClusterPeer(peer: RpcPeer, onClusterPeer?: (clusterPeer: RpcPeer) => void) {
    const SCRYPTED_CLUSTER_ADDRESS = process.env.SCRYPTED_CLUSTER_ADDRESS;
    let clusterId: string;
    let clusterSecret: string;
    let clusterPort: number;

    // all cluster clients, incoming and outgoing, connect with random ports which can be used as peer ids
    // on the cluster server that is listening on the actual port/
    // incoming connections: use the remote random/unique port
    // outgoing connections: use the local random/unique port
    const clusterPeers = new Map<string, Promise<RpcPeer>>();


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

    const connectRPCObject = async (o: ClusterObject) => {
        const sha256 = computeClusterObjectHash(o, clusterSecret);
        if (sha256 !== o.sha256)
            throw new Error('secret incorrect');
        return resolveObject(o.proxyId, o.sourceKey);
    }

    function isClusterAddress(address: string) {
        return !address || address === SCRYPTED_CLUSTER_ADDRESS;
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
    }) => {
        if (clusterPort)
            return;

        ({ clusterId, clusterSecret } = options);

        const clusterRpcServer = net.createServer(client => {
            const clusterPeerAddress = client.remoteAddress;
            const clusterPeerPort = client.remotePort;
            const clusterPeerKey = getClusterPeerKey(clusterPeerAddress, clusterPeerPort);
            const clusterPeer = createDuplexRpcPeer(peer.selfName, clusterPeerKey, client, client);
            Object.assign(clusterPeer.params, peer.params);
            // the listening peer sourceKey (client address/port) is used by the OTHER peer (the client)
            // to determine if it is already connected to THIS peer (the server).
            clusterPeer.onProxySerialization = (value) => onProxySerialization(clusterPeer, value, clusterPeerKey);
            clusterPeers.set(clusterPeerKey, Promise.resolve(clusterPeer));
            onClusterPeer?.(clusterPeer);
            clusterPeer.params.connectRPCObject = connectRPCObject;
            client.on('close', () => {
                clusterPeers.delete(clusterPeerKey);
                clusterPeer.kill('cluster socket closed');
            });
        })

        const listenAddress = SCRYPTED_CLUSTER_ADDRESS
            ? '0.0.0.0'
            : '127.0.0.1';

        clusterPort = await listenZero(clusterRpcServer, listenAddress);
        peer.onProxySerialization = value => onProxySerialization(peer, value, undefined);
        delete peer.params.initializeCluster;
    }

    return {
        initializeCluster,
        get clusterPort() {
            return clusterPort;
        },
        get clusterId() {
            return clusterId;
        },
        get clusterSecret() {
            return clusterSecret;
        },
        SCRYPTED_CLUSTER_ADDRESS,
        isClusterAddress,
        clusterPeers,
        onProxySerialization,
        connectRPCObject,
    }
}