import os from 'os';
import net from 'net';
import tls from 'tls';
import type { createSelfSignedCertificate } from './cert';
import { computeClusterObjectHash } from './cluster/cluster-hash';
import { ClusterObject } from './cluster/connect-rpc-object';
import { loopbackList } from './ip';
import { RpcPeer } from './rpc';
import { createRpcDuplexSerializer } from './rpc-serializer';
import type { ScryptedRuntime } from './runtime';
import { SCRYPTED_CLUSTER_WORKERS } from './server-settings';
import { sleep } from './sleep';
import { once } from 'events';

export interface ClusterWorkerProperties {
    labels: string[];
}

export interface ClusterWorker extends ClusterWorkerProperties {
    peer: RpcPeer;
}

export function getScryptedClusterMode(): ['server' | 'client', string, number] {
    const mode = process.env.SCRYPTED_CLUSTER_MODE as 'server' | 'client';
    if (!mode)
        return;

    if (!['server', 'client'].includes(mode))
        throw new Error('SCRYPTED_CLUSTER_MODE must be set to either "server" or "client".');

    const [server, sport] = process.env.SCRYPTED_CLUSTER_SERVER?.split(':') || [];
    const port = parseInt(sport) || 10556;
    if (!net.isIP(server)) {
        if (server)
            throw new Error('SCRYPTED_CLUSTER_SERVER is set but is not a valid IP address.');
        if (process.env.SCRYPTED_CLUSTER_SECRET)
            throw new Error('SCRYPTED_CLUSTER_SECRET is set but SCRYPTED_CLUSTER_SERVER is not set.');
        return;
    }
    if (!process.env.SCRYPTED_CLUSTER_SECRET)
        throw new Error('SCRYPTED_CLUSTER_SERVER is set but SCRYPTED_CLUSTER_SECRET is not set.');
    return [mode, server, port];
}

export function startClusterClient(mainFilename: string) {
    let labels = process.env.SCRYPTED_CLUSTER_LABELS?.split(',') || [];
    labels.push(process.arch, process.platform, os.hostname());
    labels = [...new Set(labels)];

    const secret = process.env.SCRYPTED_CLUSTER_SECRET;
    const clusterMode = getScryptedClusterMode();
    const [, host, port] = clusterMode;
    for (let i = 0; i < SCRYPTED_CLUSTER_WORKERS; i++) {
        (async () => {
            while (true) {
                const backoff = sleep(10000);
                try {
                    const client = tls.connect({
                        host,
                        port,
                        rejectUnauthorized: false,
                    });

                    const serializer = createRpcDuplexSerializer(client);
                    const peer = new RpcPeer('cluster-remote', 'cluster-host', (message, reject, serializationContext) => {
                        serializer.sendMessage(message, reject, serializationContext);
                    });
                    serializer.setupRpcPeer(peer);
                    client.on('data', data => serializer.onData(data));
                    client.on('error', e => {
                        peer.kill(e);
                    });
                    client.on('close', () => {
                        peer.kill('cluster server closed');
                    });
                    const connectForkWorker = await peer.getParam('connectForkWorker');
                    const auth: ClusterObject = {
                        address: client.localAddress,
                        port: client.localPort,
                        id: undefined,
                        proxyId: undefined,
                        sourceKey: undefined,
                        sha256: undefined,
                    };
                    auth.sha256 = computeClusterObjectHash(auth, secret);

                    const properties: ClusterWorkerProperties = {
                        labels,
                    };

                    await connectForkWorker(auth, properties);
                    console.warn('worker ready');
                }
                catch (e) {
                }
                await backoff;
            }
        })();
    }
}

export function createClusterServer(runtime: ScryptedRuntime, certificate: ReturnType<typeof createSelfSignedCertificate>) {
    const server = tls.createServer({
        key: certificate.serviceKey,
        cert: certificate.certificate,
    }, (socket) => {
        const serializer = createRpcDuplexSerializer(socket);
        const peer = new RpcPeer('cluster-host', 'cluster-remote', (message, reject, serializationContext) => {
            serializer.sendMessage(message, reject, serializationContext);
        });
        serializer.setupRpcPeer(peer);
        socket.on('data', data => serializer.onData(data));
        socket.on('error', e => {
            peer.kill(e);
        });
        socket.on('close', () => {
            peer.kill('cluster client closed');
        });
        peer.killed.then(() => {
            socket.destroy();
        });

        peer.params['connectForkWorker'] = async (auth: ClusterObject, properties: ClusterWorkerProperties) => {
            try {
                const sha256 = computeClusterObjectHash(auth, runtime.clusterSecret);
                if (sha256 !== auth.sha256)
                    throw new Error('cluster object hash mismatch');
                // the remote address may be ipv6 prefixed so use a fuzzy match.
                // eg ::ffff:192.168.2.124
                if (auth.port !== socket.remotePort || !socket.remoteAddress.endsWith(auth.address))
                    throw new Error('cluster object address mismatch');
                const worker: ClusterWorker = {
                    ...properties,
                    peer,
                };
                runtime.clusterWorkers.add(worker);
                peer.killed.then(() => {
                    runtime.clusterWorkers.delete(worker);
                });
                socket.on('close', () => {
                    runtime.clusterWorkers.delete(worker);
                });
            }
            catch (e) {
                peer.kill(e);
            }
        }
    });

    return server;
}