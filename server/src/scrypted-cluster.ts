import { ForkOptions } from '@scrypted/types';
import child_process, { fork } from 'child_process';
import net from 'net';
import os from 'os';
import tls from 'tls';
import worker_threads from 'worker_threads';
import type { createSelfSignedCertificate } from './cert';
import { computeClusterObjectHash } from './cluster/cluster-hash';
import { ClusterObject } from './cluster/connect-rpc-object';
import { listenZeroSingleClient } from './listen-zero';
import { PluginRemoteLoadZipOptions, PluginZipAPI } from './plugin/plugin-api';
import { getPluginVolume } from './plugin/plugin-volume';
import { ChildProcessWorker } from './plugin/runtime/child-process-worker';
import { prepareZip } from './plugin/runtime/node-worker-common';
import { getBuiltinRuntimeHosts } from './plugin/runtime/runtime-host';
import { RuntimeWorker } from './plugin/runtime/runtime-worker';
import { RpcPeer } from './rpc';
import { createRpcDuplexSerializer } from './rpc-serializer';
import type { ScryptedRuntime } from './runtime';
import { sleep } from './sleep';
import { prepareClusterPeer } from './scrypted-cluster-common';
import { Readable } from 'stream';

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

export type ClusterForkParam = (peerLiveness: PeerLiveness, options: ForkOptions, packageJson: any, zipAPI: PluginZipAPI, zipOptions: PluginRemoteLoadZipOptions) => Promise<ClusterForkResult>;
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
    const peer = new RpcPeer('cluster-remote', 'cluster-host', (message, reject, serializationContext) => {
        serializer.sendMessage(message, reject, serializationContext);
    });

    peerLifecycle(serializer, peer, socket, type);

    return peer;
}

export function matchesClusterLabels(options: ForkOptions, labels: string[]) {
    for (const label of options.labels) {
        if (!labels.includes(label))
            return false;
    }
    return true;
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
                    options: ForkOptions,
                    packageJson: any,
                    zipAPI: PluginZipAPI,
                    zipOptions: PluginRemoteLoadZipOptions) => {
                    if (!options.runtime || !options.labels?.length) {
                        console.warn('invalid cluster fork options');
                        peer.kill('invalid cluster fork options');
                        throw new Error('invalid cluster fork options');
                    }

                    let runtimeWorker: RuntimeWorker;
                    let nativeWorker: child_process.ChildProcess | worker_threads.Worker;

                    const builtins = getBuiltinRuntimeHosts();
                    const runtime = builtins.get(options.runtime);
                    if (!runtime)
                        throw new Error('unknown runtime ' + options.runtime);

                    const { zipHash } = zipOptions;
                    const pluginId: string = packageJson.name;
                    const { zipFile, unzippedPath } = await prepareZip(getPluginVolume(pluginId), zipHash, zipAPI.getZip);

                    runtimeWorker = runtime(mainFilename, pluginId, {
                        packageJson,
                        env: process.env,
                        pluginDebug: undefined,
                        zipFile,
                        unzippedPath,
                        zipHash,
                    }, undefined);

                    if (runtimeWorker instanceof ChildProcessWorker) {
                        nativeWorker = runtimeWorker.childProcess;
                        // const console = options?.id ? getMixinConsole(options.id, options.nativeId) : undefined;
                        // pipeWorkerConsole(nativeWorker, console);
                    }

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
        const peer = preparePeer(socket, 'server');

        const connectForkWorker: ConnectForkWorker = async (auth: ClusterObject, properties: ClusterWorkerProperties) => {
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