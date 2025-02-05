import type { ForkOptions } from '@scrypted/types';
import crypto from 'crypto';
import { once } from 'events';
import fs from 'fs';
import net from 'net';
import os from 'os';
import { install as installSourceMapSupport } from 'source-map-support';
import type { Readable } from 'stream';
import tls from 'tls';
import type { createSelfSignedCertificate } from './cert';
import { computeClusterObjectHash } from './cluster/cluster-hash';
import { getClusterLabels, getClusterWorkerWeight } from './cluster/cluster-labels';
import { getScryptedClusterMode, InitializeCluster, setupCluster } from './cluster/cluster-setup';
import type { ClusterObject } from './cluster/connect-rpc-object';
import { getScryptedFFmpegPath } from './plugin/ffmpeg-path';
import { getPluginVolume, getScryptedVolume } from './plugin/plugin-volume';
import { prepareZip } from './plugin/runtime/node-worker-common';
import { getBuiltinRuntimeHosts } from './plugin/runtime/runtime-host';
import type { RuntimeWorker, RuntimeWorkerOptions } from './plugin/runtime/runtime-worker';
import { RpcPeer } from './rpc';
import { createRpcDuplexSerializer } from './rpc-serializer';
import type { ScryptedRuntime } from './runtime';
import { EnvControl } from './services/env';
import { Info } from './services/info';
import { ServiceControl } from './services/service-control';
import { sleep } from './sleep';

installSourceMapSupport({
    environment: 'node',
});

async function start(mainFilename: string, options?: {
    onClusterWorkerCreated?: (options?: {
        clusterPluginHosts?: ReturnType<typeof getBuiltinRuntimeHosts>,
    }) => Promise<void>,
    serviceControl?: ServiceControl;
}) {
    options ||= {};
    options.serviceControl ||= new ServiceControl();
    startClusterClient(mainFilename, options);
}

export default start;

function peerLifecycle(serializer: ReturnType<typeof createRpcDuplexSerializer>, peer: RpcPeer, socket: tls.TLSSocket, type: 'server' | 'client') {
    serializer.setupRpcPeer(peer);

    socket.on('data', data => serializer.onData(data));

    socket.on('error', e => {
        peer.kill(e.message);
    });
    socket.on('close', () => {
        peer.kill(`cluster ${type} closed`);
    });
    peer.killedSafe.finally(() => {
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
    id?: ForkOptions['id'];
    clusterWorkerId?: ForkOptions['clusterWorkerId'];
}

type ConnectForkWorker = (auth: ClusterObject, properties: ClusterWorkerProperties) => Promise<{ clusterId: string, clusterWorkerId: string }>;

export interface ClusterWorkerProperties {
    labels: string[];
    weight: number;
}

export interface RunningClusterWorker extends ClusterWorkerProperties {
    id: string;
    name: string;
    peer: RpcPeer;
    fork: Promise<ClusterForkParam>;
    forks: Set<ClusterForkOptions>;
    address: string;
    weight: number;
    mode: 'server' | 'client';
}

export class PeerLiveness {
    constructor(private killed: Promise<any>) {
    }
    async waitKilled() {
        return this.killed;
    }
}

export class ClusterForkResult extends PeerLiveness implements ClusterForkResultInterface {
    [RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS] = ['kill'];
    clusterWorkerId?: string;

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

export interface ClusterForkResultInterface {
    clusterWorkerId?: string;
    getResult(): Promise<any>;
    kill(): Promise<void>;
    waitKilled(): Promise<void>;
}

export type ClusterForkParam = (runtime: string, options: RuntimeWorkerOptions, peerLiveness: PeerLiveness, getZip: () => Promise<Buffer>) => Promise<ClusterForkResultInterface>;

function createClusterForkParam(mainFilename: string, clusterId: string, clusterSecret: string, clusterWorkerId: string, clusterPluginHosts: ReturnType<typeof getBuiltinRuntimeHosts>) {
    const clusterForkParam: ClusterForkParam = async (runtime, runtimeWorkerOptions, peerLiveness, getZip) => {
        let runtimeWorker: RuntimeWorker;

        const rt = clusterPluginHosts.get(runtime);
        if (!rt)
            throw new Error('unknown runtime ' + runtime);

        const pluginId: string = runtimeWorkerOptions.packageJson.name;
        const { zipFile, unzippedPath } = await prepareZip(getPluginVolume(pluginId), runtimeWorkerOptions.zipHash, getZip);

        const volume = getScryptedVolume();
        const pluginVolume = getPluginVolume(pluginId);

        runtimeWorkerOptions.zipFile = zipFile;
        runtimeWorkerOptions.unzippedPath = unzippedPath;

        runtimeWorkerOptions.env = {
            ...runtimeWorkerOptions.env,
            SCRYPTED_VOLUME: volume,
            SCRYPTED_PLUGIN_VOLUME: pluginVolume,
            SCRYPTED_FFMPEG_PATH: process.env.SCRYPTED_FFMPEG_PATH || await getScryptedFFmpegPath(),
        };

        runtimeWorker = rt(mainFilename, runtimeWorkerOptions, undefined);
        runtimeWorker.stdout.on('data', data => console.log(data.toString()));
        runtimeWorker.stderr.on('data', data => console.error(data.toString()));

        const threadPeer = new RpcPeer('main', 'thread', (message, reject, serializationContext) => runtimeWorker.send(message, reject, serializationContext));
        runtimeWorker.setupRpcPeer(threadPeer);
        runtimeWorker.on('exit', () => {
            threadPeer.kill('worker exited');
        });
        runtimeWorker.on('error', e => {
            threadPeer.kill('worker error ' + e);
        });
        threadPeer.killedSafe.finally(() => {
            runtimeWorker.kill();
        });
        peerLiveness.waitKilled().catch(() => { }).finally(() => {
            threadPeer.kill('peer killed');
        });
        let getRemote: any;
        let ping: any;
        try {
            const initializeCluster: InitializeCluster = await threadPeer.getParam('initializeCluster');
            await initializeCluster({ clusterId, clusterSecret, clusterWorkerId });
            getRemote = await threadPeer.getParam('getRemote');
            ping = await threadPeer.getParam('ping');
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
                ping,
            };
        };

        const result = new ClusterForkResult(threadPeer, threadPeer.killed, clusterGetRemote);
        return result;
    };

    return clusterForkParam;
}

export function startClusterClient(mainFilename: string, options?: {
    onClusterWorkerCreated?: (options?: {
        clusterPluginHosts?: ReturnType<typeof getBuiltinRuntimeHosts>,
    }) => Promise<void>,
    serviceControl?: ServiceControl;
}) {
    console.log('Cluster client starting.');

    const envControl = new EnvControl();

    const originalClusterAddress = process.env.SCRYPTED_CLUSTER_ADDRESS;
    const labels = getClusterLabels();
    const weight = getClusterWorkerWeight();

    const clusterSecret = process.env.SCRYPTED_CLUSTER_SECRET;
    const clusterMode = getScryptedClusterMode();
    const [, host, port] = clusterMode;

    const clusterPluginHosts = getBuiltinRuntimeHosts();
    options?.onClusterWorkerCreated?.({ clusterPluginHosts });

    (async () => {
        while (true) {
            // this sleep is here to prevent a tight loop if the server is down.
            // furthermore, the mac desktop app needs to pop a privacy warning
            // for local network, and having the immediate socket connection seems
            // to hang the app since no window is created yet.
            await sleep(1000);

            const rawSocket = net.connect({
                host,
                port,
                // require ipv4 to normalize cluster address.
                family: 4,
            });

            try {
                await once(rawSocket, 'connect');
            }
            catch (e) {
                console.warn('Cluster server not available.', host, port, e);
                continue;
            }

            const socket = tls.connect({
                socket: rawSocket,
                rejectUnauthorized: false,
            });

            try {
                await once(socket, 'secureConnect');
            }
            catch (e) {
                console.warn('Cluster server tls failed.', host, port, e);
                continue;
            }

            if (originalClusterAddress && originalClusterAddress !== socket.localAddress)
                console.warn('SCRYPTED_CLUSTER_ADDRESS mismatch? Ignoring auto detected address and using the user specified setting.', originalClusterAddress, socket.localAddress);
            else
                process.env.SCRYPTED_CLUSTER_ADDRESS = socket.localAddress;

            const peer = preparePeer(socket, 'client');
            peer.params['service-control'] = options?.serviceControl;
            peer.params['env-control'] = envControl;
            peer.params['info'] = new Info();
            peer.params['fs.promises'] = {
                [RpcPeer.PROPERTY_JSON_COPY_SERIALIZE_CHILDREN]: true,
                ...fs.promises,
            };

            const { localAddress, localPort } = socket;
            console.log('Cluster server connected.', localAddress, localPort);
            socket.on('close', () => {
                console.log('Cluster server disconnected.', localAddress, localPort);
            });

            try {
                const connectForkWorker: ConnectForkWorker = await peer.getParam('connectForkWorker');
                const auth: ClusterObject = {
                    address: socket.localAddress,
                    port: socket.localPort,
                    id: process.env.SCRYPTED_CLUSTER_WORKER_NAME || os.hostname(),
                    proxyId: undefined,
                    sourceKey: undefined,
                    sha256: undefined,
                };
                auth.sha256 = computeClusterObjectHash(auth, clusterSecret);

                const properties: ClusterWorkerProperties = {
                    labels,
                    weight,
                };

                const { clusterId, clusterWorkerId } = await connectForkWorker(auth, properties);
                const clusterPeerSetup = setupCluster(peer);
                await clusterPeerSetup.initializeCluster({ clusterId, clusterSecret, clusterWorkerId });

                peer.params['fork'] = createClusterForkParam(mainFilename, clusterId, clusterSecret, clusterWorkerId, clusterPluginHosts);

                await peer.killed;
            }
            catch (e) {
                peer.kill(e.message);
                console.warn('Cluster client error:', localAddress, localPort, e);
            }
            finally {
                peer.kill();
                socket.destroy();
            }
        }
    })();
}

export function createClusterServer(mainFilename: string, scryptedRuntime: ScryptedRuntime, certificate: ReturnType<typeof createSelfSignedCertificate>) {
    scryptedRuntime.serverClusterWorkerId = crypto.randomUUID();
    const serverWorker: RunningClusterWorker = {
        labels: getClusterLabels(),
        id: scryptedRuntime.serverClusterWorkerId,
        peer: undefined,
        fork: Promise.resolve(createClusterForkParam(mainFilename, scryptedRuntime.clusterId, scryptedRuntime.clusterSecret, scryptedRuntime.serverClusterWorkerId, scryptedRuntime.pluginHosts)),
        name: process.env.SCRYPTED_CLUSTER_WORKER_NAME || os.hostname(),
        address: process.env.SCRYPTED_CLUSTER_ADDRESS,
        weight: getClusterWorkerWeight(),
        forks: new Set(),
        mode: 'server',
    };
    scryptedRuntime.clusterWorkers.set(scryptedRuntime.serverClusterWorkerId, serverWorker);

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
            const id = crypto.randomUUID();
            try {
                const sha256 = computeClusterObjectHash(auth, scryptedRuntime.clusterSecret);
                if (sha256 !== auth.sha256)
                    throw new Error('cluster object hash mismatch');

                peer.peerName = auth.id || `${socket.remoteAddress}`;

                // the remote address may be ipv6 prefixed so use a fuzzy match.
                // eg ::ffff:192.168.2.124
                if (!process.env.SCRYPTED_DISABLE_CLUSTER_SERVER_TRUST) {
                    if (auth.port !== socket.remotePort || !socket.remoteAddress.endsWith(auth.address))
                        throw new Error('cluster object address mismatch');
                }
                const worker: RunningClusterWorker = {
                    ...properties,
                    id,
                    peer,
                    fork: undefined,
                    name: auth.id,
                    address: socket.remoteAddress,
                    forks: new Set(),
                    mode: 'client',
                };
                scryptedRuntime.clusterWorkers.set(id, worker);
                peer.killedSafe.finally(() => {
                    scryptedRuntime.clusterWorkers.delete(id);
                });
                socket.on('close', () => {
                    scryptedRuntime.clusterWorkers.delete(id);
                });
                console.log('Cluster client authenticated.', socket.remoteAddress, socket.remotePort, properties);
            }
            catch (e) {
                console.error('Cluster client authentication failed.', socket.remoteAddress, socket.remotePort, e);
                peer.kill(e);
                socket.destroy();
            }

            return {
                clusterId: scryptedRuntime.clusterId,
                clusterWorkerId: id,
            }
        }
        peer.params['connectForkWorker'] = connectForkWorker;
    });

    return server;
}
