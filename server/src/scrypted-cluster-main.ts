import os from 'os';
import type { ForkOptions } from '@scrypted/types';
import { once } from 'events';
import net from 'net';
import { install as installSourceMapSupport } from 'source-map-support';
import type { Readable } from 'stream';
import tls from 'tls';
import type { createSelfSignedCertificate } from './cert';
import { computeClusterObjectHash } from './cluster/cluster-hash';
import { getClusterLabels } from './cluster/cluster-labels';
import { getScryptedClusterMode, InitializeCluster, setupCluster } from './cluster/cluster-setup';
import type { ClusterObject } from './cluster/connect-rpc-object';
import { getPluginVolume, getScryptedVolume } from './plugin/plugin-volume';
import { prepareZip } from './plugin/runtime/node-worker-common';
import { getBuiltinRuntimeHosts } from './plugin/runtime/runtime-host';
import { RuntimeWorker } from './plugin/runtime/runtime-worker';
import { RpcPeer } from './rpc';
import { createRpcDuplexSerializer } from './rpc-serializer';
import type { ScryptedRuntime } from './runtime';
import { sleep } from './sleep';
import crypto from 'crypto';

installSourceMapSupport({
    environment: 'node',
});

async function start(mainFilename: string) {
    startClusterClient(mainFilename);
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
}

type ConnectForkWorker = (auth: ClusterObject, properties: ClusterWorkerProperties) => Promise<{ clusterId: string }>;

export interface ClusterWorkerProperties {
    labels: string[];
}

export interface ClusterWorker extends ClusterWorkerProperties {
    id: string;
    peer: RpcPeer;
    forks: Set<ClusterForkOptions>;
}

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

export function startClusterClient(mainFilename: string) {
    const originalClusterAddress = process.env.SCRYPTED_CLUSTER_ADDRESS;
    const labels = getClusterLabels();

    const clusterSecret = process.env.SCRYPTED_CLUSTER_SECRET;
    const clusterMode = getScryptedClusterMode();
    const [, host, port] = clusterMode;
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
                continue;
            }

            if (originalClusterAddress && originalClusterAddress !== socket.localAddress)
                console.warn('SCRYPTED_CLUSTER_ADDRESS mismatch? Ignoring auto detected address and using the user specified setting.', originalClusterAddress, socket.localAddress);
            else
                process.env.SCRYPTED_CLUSTER_ADDRESS = socket.localAddress;

            const peer = preparePeer(socket, 'client');
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
                    id: process.env.SCRYPTED_CLUSTER_ID || os.hostname(),
                    proxyId: undefined,
                    sourceKey: undefined,
                    sha256: undefined,
                };
                auth.sha256 = computeClusterObjectHash(auth, clusterSecret);

                const properties: ClusterWorkerProperties = {
                    labels,
                };

                const { clusterId } = await connectForkWorker(auth, properties);
                const clusterPeerSetup = setupCluster(peer);
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
                        await initializeCluster({ clusterId, clusterSecret });
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

                peer.params['fork'] = clusterForkParam;

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

                peer.peerName = auth.id || `${socket.remoteAddress}`;

                // the remote address may be ipv6 prefixed so use a fuzzy match.
                // eg ::ffff:192.168.2.124
                if (!process.env.SCRYPTED_DISABLE_CLUSTER_SERVER_TRUST) {
                    if (auth.port !== socket.remotePort || !socket.remoteAddress.endsWith(auth.address))
                        throw new Error('cluster object address mismatch');
                }
                const id = crypto.randomUUID();
                const worker: ClusterWorker = {
                    ...properties,
                    // generate a random uuid.
                    id,
                    peer,
                    forks: new Set(),
                };
                runtime.clusterWorkers.set(id, worker);
                peer.killedSafe.finally(() => {
                    runtime.clusterWorkers.delete(id);
                });
                socket.on('close', () => {
                    runtime.clusterWorkers.delete(id);
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
