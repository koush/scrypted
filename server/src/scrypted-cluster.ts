import type { ForkOptions } from '@scrypted/types';
import net from 'net';
import os from 'os';
import type { Readable } from 'stream';
import tls from 'tls';
import type { createSelfSignedCertificate } from './cert';
import { computeClusterObjectHash } from './cluster/cluster-hash';
import type { ClusterObject } from './cluster/connect-rpc-object';
import { getPluginVolume, getScryptedVolume } from './plugin/plugin-volume';
import { prepareZip } from './plugin/runtime/node-worker-common';
import { getBuiltinRuntimeHosts } from './plugin/runtime/runtime-host';
import { RuntimeWorker } from './plugin/runtime/runtime-worker';
import { RpcPeer } from './rpc';
import { createRpcDuplexSerializer } from './rpc-serializer';
import type { ScryptedRuntime } from './runtime';
import { prepareClusterPeer } from './scrypted-cluster-common';
import { sleep } from './sleep';

export class PeerLiveness {
    __proxy_oneway_methods = ['kill'];
    constructor(private killed: Promise<any>) {
    }
    async waitKilled() {
        return this.killed;
    }
}

export class ClusterForkResult extends PeerLiveness {
    constructor(private peer: RpcPeer, killed: Promise<any>, private result: any) {
        super(killed);
    }

    async kill() {
        this.peer.kill('killed');
    }

    async getResult() {
        return this.result;
    }
}

export type ClusterForkParam = (peerLiveness: PeerLiveness, runtime: string, packageJson: any, zipHash: string, getZip: () => Promise<Buffer>) => Promise<ClusterForkResult>;
export type InitializeCluster = (cluster: { clusterId: string, clusterSecret: string }) => Promise<void>;

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

    if (!process.env.SCRYPTED_CLUSTER_SECRET)
        throw new Error('SCRYPTED_CLUSTER_MODE is set but SCRYPTED_CLUSTER_SECRET is not set.');

    const [server, sport] = process.env.SCRYPTED_CLUSTER_SERVER?.split(':') || [];
    const port = parseInt(sport) || 10556;
    const address = process.env.SCRYPTED_CLUSTER_ADDRESS;

    if (mode === 'client') {
        if (!net.isIP(server))
            throw new Error('SCRYPTED_CLUSTER_SERVER is not a valid IP address:port.');

        if (!net.isIP(address))
            throw new Error('SCRYPTED_CLUSTER_ADDRESS is not set to a valid IP address.');
    }
    else {
        // the cluster address may come from the server:port combo or address variable but not both.
        if (address && server && server !== address)
            throw new Error('SCRYPTED_CLUSTER_ADDRESS and SCRYPTED_CLUSTER_SERVER must not both be used.');

        const serverAddress = address || server;
        if (!net.isIP(serverAddress))
            throw new Error('SCRYPTED_CLUSTER_ADDRESS is not set.');
        process.env.SCRYPTED_CLUSTER_ADDRESS = serverAddress;
        delete process.env.SCRYPTED_CLUSTER_SERVER;
    }

    return [mode, server, port];
}

function peerLifecycle(serializer: ReturnType<typeof createRpcDuplexSerializer>, peer: RpcPeer, socket: tls.TLSSocket, type: 'server' | 'client') {
    serializer.setupRpcPeer(peer);

    socket.on('data', data => serializer.onData(data));

    socket.on('error', e => {
        peer.kill(e.message);
    });
    socket.on('close', () => {
        peer.kill(`cluster ${type} closed`);
    });
    peer.killed.then(() => {
        socket.destroy();
    });
}

function preparePeer(socket: tls.TLSSocket, type: 'server' | 'client') {
    const serializer = createRpcDuplexSerializer(socket);
    const peer = new RpcPeer(`cluster-remote:${socket.remoteAddress}:${socket.remotePort}`, 'cluster-host', (message, reject, serializationContext) => {
        serializer.sendMessage(message, reject, serializationContext);
    });

    peerLifecycle(serializer, peer, socket, type);

    return peer;
}

export interface ClusterForkOptions {
    runtime?: ForkOptions['runtime'];
    labels?: ForkOptions['labels'];
}

export function matchesClusterLabels(options: ClusterForkOptions, labels: string[]) {
    let matched = 0;
    for (const label of options?.labels?.require || []) {
        if (!labels.includes(label))
            return 0;
    }

    // if there is nothing in the any list, consider it matched
    let foundAny = !options?.labels?.any?.length;
    for (const label of options.labels?.any || []) {
        if (labels.includes(label)) {
            matched++;
            foundAny = true;
        }
    }
    if (!foundAny)
        return 0;

    for (const label of options?.labels?.prefer || []) {
        if (labels.includes(label))
            matched++;
    }
    // ensure non zero result.
    matched++;
    return matched;
}

export function getClusterLabels() {
    let labels = process.env.SCRYPTED_CLUSTER_LABELS?.split(',') || [];
    labels.push(process.arch, process.platform, os.hostname());
    labels = [...new Set(labels)];
    return labels;
}

type ConnectForkWorker = (auth: ClusterObject, properties: ClusterWorkerProperties) => Promise<{ clusterId: string }>;

export function startClusterClient(mainFilename: string) {
    const labels = getClusterLabels();

    const clusterSecret = process.env.SCRYPTED_CLUSTER_SECRET;
    const clusterMode = getScryptedClusterMode();
    const [, host, port] = clusterMode;
    (async () => {
        while (true) {
            const backoff = sleep(10000);
            const socket = tls.connect({
                host,
                port,
                rejectUnauthorized: false,
            });

            const { localAddress, localPort } = socket;
            socket.on('secureConnect', () => {
                console.log('Cluster server connected.', localAddress, localPort);
            });
            socket.on('close', () => {
                console.log('Cluster server disconnected.', localAddress, localPort);
            });

            const peer = preparePeer(socket, 'client');

            try {
                const connectForkWorker: ConnectForkWorker = await peer.getParam('connectForkWorker');
                const auth: ClusterObject = {
                    address: socket.localAddress,
                    port: socket.localPort,
                    id: undefined,
                    proxyId: undefined,
                    sourceKey: undefined,
                    sha256: undefined,
                };
                auth.sha256 = computeClusterObjectHash(auth, clusterSecret);

                const properties: ClusterWorkerProperties = {
                    labels,
                };

                const { clusterId } = await connectForkWorker(auth, properties);
                const clusterPeerSetup = prepareClusterPeer(peer);
                await clusterPeerSetup.initializeCluster({ clusterId, clusterSecret });

                const clusterForkParam: ClusterForkParam = async (
                    peerLiveness: PeerLiveness,
                    runtime: string,
                    packageJson: any,
                    zipHash: string,
                    getZip: () => Promise<Buffer>) => {
                    let runtimeWorker: RuntimeWorker;

                    const builtins = getBuiltinRuntimeHosts();
                    const rt = builtins.get(runtime);
                    if (!rt)
                        throw new Error('unknown runtime ' + runtime);

                    const pluginId: string = packageJson.name;
                    const { zipFile, unzippedPath } = await prepareZip(getPluginVolume(pluginId), zipHash, getZip);

                    const volume = getScryptedVolume();
                    const pluginVolume = getPluginVolume(pluginId);

                    runtimeWorker = rt(mainFilename, pluginId, {
                        packageJson,
                        env: {
                            SCRYPTED_VOLUME: volume,
                            SCRYPTED_PLUGIN_VOLUME: pluginVolume,
                        },
                        pluginDebug: undefined,
                        zipFile,
                        unzippedPath,
                        zipHash,
                    }, undefined);

                    const threadPeer = new RpcPeer('main', 'thread', (message, reject, serializationContext) => runtimeWorker.send(message, reject, serializationContext));
                    runtimeWorker.setupRpcPeer(threadPeer);
                    runtimeWorker.on('exit', () => {
                        threadPeer.kill('worker exited');
                    });
                    runtimeWorker.on('error', e => {
                        threadPeer.kill('worker error ' + e);
                    });
                    threadPeer.killed.catch(() => { }).finally(() => {
                        runtimeWorker.kill();
                    });
                    peerLiveness.waitKilled().catch(() => { }).finally(() => {
                        threadPeer.kill('peer killed');
                    });
                    let getRemote: any;
                    try {
                        const initializeCluster: InitializeCluster = await threadPeer.getParam('initializeCluster');
                        await initializeCluster({ clusterId, clusterSecret });
                        getRemote = await threadPeer.getParam('getRemote');
                    }
                    catch (e) {
                        threadPeer.kill('cluster fork failed');
                        throw e;
                    }

                    const readStream = async function* (stream: Readable) {
                        for await (const buffer of stream) {
                            yield buffer;
                        }
                    }

                    const timeout = setTimeout(() => {
                        threadPeer.kill('cluster fork timeout');
                    }, 10000);
                    const clusterGetRemote = (...args: any[]) => {
                        clearTimeout(timeout);
                        return {
                            [RpcPeer.PROPERTY_JSON_COPY_SERIALIZE_CHILDREN]: true,
                            stdout: readStream(runtimeWorker.stdout),
                            stderr: readStream(runtimeWorker.stderr),
                            getRemote,
                        };
                    };

                    const result = new ClusterForkResult(threadPeer, threadPeer.killed, clusterGetRemote);
                    return result;
                };

                peer.params['fork'] = clusterForkParam;

                await peer.killed;
            }
            catch (e) {
                peer.kill(e.message);
                socket.destroy();
                console.warn('Cluster client error:', localAddress, localPort, e);
            }
            await backoff;
        }
    })();
}

export function createClusterServer(runtime: ScryptedRuntime, certificate: ReturnType<typeof createSelfSignedCertificate>) {
    const server = tls.createServer({
        key: certificate.serviceKey,
        cert: certificate.certificate,
    }, (socket) => {
        console.log('Cluster client connected.', socket.remoteAddress, socket.remotePort);
        socket.on('close', () => {
            console.log('Cluster client disconnected.', socket.remoteAddress, socket.remotePort);
        });

        const peer = preparePeer(socket, 'server');

        const connectForkWorker: ConnectForkWorker = async (auth: ClusterObject, properties: ClusterWorkerProperties) => {
            try {
                const sha256 = computeClusterObjectHash(auth, runtime.clusterSecret);
                if (sha256 !== auth.sha256)
                    throw new Error('cluster object hash mismatch');
                // the remote address may be ipv6 prefixed so use a fuzzy match.
                // eg ::ffff:192.168.2.124
                if (!process.env.SCRYPTED_DISABLE_CLUSTER_SERVER_TRUST) {
                    if (auth.port !== socket.remotePort || !socket.remoteAddress.endsWith(auth.address))
                        throw new Error('cluster object address mismatch');
                }
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
                console.log('Cluster client authenticated.', socket.remoteAddress, socket.remotePort, properties);
            }
            catch (e) {
                peer.kill(e);
                socket.destroy();
            }

            return {
                clusterId: runtime.clusterId,
            }
        }
        peer.params['connectForkWorker'] = connectForkWorker;
    });

    return server;
}