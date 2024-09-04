import { ForkWorker, ScryptedStatic, SystemManager } from '@scrypted/types';
import child_process from 'child_process';
import { once } from 'events';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { install as installSourceMapSupport } from 'source-map-support';
import worker_threads from 'worker_threads';
import { computeClusterObjectHash } from '../cluster/cluster-hash';
import { ClusterObject, ConnectRPCObject } from '../cluster/connect-rpc-object';
import { listenZero } from '../listen-zero';
import { RpcMessage, RpcPeer } from '../rpc';
import { evalLocal } from '../rpc-peer-eval';
import { createDuplexRpcPeer } from '../rpc-serializer';
import { MediaManagerImpl } from './media';
import { PluginAPI, PluginAPIProxy, PluginRemote, PluginRemoteLoadZipOptions } from './plugin-api';
import { pipeWorkerConsole, prepareConsoles } from './plugin-console';
import { getPluginNodePath, installOptionalDependencies } from './plugin-npm-dependencies';
import { DeviceManagerImpl, attachPluginRemote, setupPluginRemote } from './plugin-remote';
import { PluginStats, startStatsUpdater } from './plugin-remote-stats';
import { createREPLServer } from './plugin-repl';
import { getPluginVolume } from './plugin-volume';
import { NodeThreadWorker } from './runtime/node-thread-worker';
import { prepareZip } from './runtime/node-worker-common';
import { RuntimeWorker } from './runtime/runtime-worker';
import { getBuiltinRuntimeHosts } from './runtime/runtime-host';
import { ChildProcessWorker } from './runtime/child-process-worker';
import { Deferred } from '../deferred';

const serverVersion = require('../../package.json').version;

export interface StartPluginRemoteOptions {
    onClusterPeer?(peer: RpcPeer): void;
    sourceURL?(filename: string): string;
    consoleId?: string;
}

export function startPluginRemote(mainFilename: string, pluginId: string, peerSend: (message: RpcMessage, reject?: (e: Error) => void, serializationContext?: any) => void, startPluginRemoteOptions?: StartPluginRemoteOptions) {
    const peer = new RpcPeer('unknown', 'host', peerSend);

    let systemManager: SystemManager;
    let deviceManager: DeviceManagerImpl;
    let api: PluginAPI;


    let pluginsPromise: Promise<any>;
    function getPlugins() {
        if (!pluginsPromise)
            pluginsPromise = api.getComponent('plugins');
        return pluginsPromise;
    }

    const { getDeviceConsole, getMixinConsole } = prepareConsoles(() => peer.selfName, () => systemManager, () => deviceManager, getPlugins);

    let replPort: Promise<number>;

    let _pluginConsole: Console;
    const getPluginConsole = () => {
        if (!_pluginConsole)
            _pluginConsole = getDeviceConsole(undefined);
        return _pluginConsole;
    }

    let postInstallSourceMapSupport: (scrypted: ScryptedStatic) => void;

    const forks = new Set<PluginRemote>();

    attachPluginRemote(peer, {
        createMediaManager: async (sm, dm) => {
            systemManager = sm;
            deviceManager = dm
            return new MediaManagerImpl(systemManager, dm);
        },
        onGetRemote: async (_api, _pluginId) => {
            class PluginForkableAPI extends PluginAPIProxy {
                [RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS] = (_api as any)[RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS];

                setStorage(nativeId: string, storage: { [key: string]: any; }): Promise<void> {
                    const id = deviceManager.nativeIds.get(nativeId).id;
                    for (const r of forks) {
                        r.setNativeId(nativeId, id, storage);
                    }
                    return super.setStorage(nativeId, storage);
                }
            }

            api = new PluginForkableAPI(_api);
            peer.selfName = pluginId;
            return api;
        },
        getPluginConsole,
        getDeviceConsole,
        getMixinConsole,
        async getServicePort(name, ...args: any[]) {
            if (name === 'repl') {
                if (!replPort)
                    throw new Error('REPL unavailable: Plugin not loaded.')
                return replPort;
            }
            throw new Error(`unknown service ${name}`);
        },
        async onLoadZip(scrypted: ScryptedStatic, params: any, packageJson: any, getZip: () => Promise<Buffer>, zipOptions: PluginRemoteLoadZipOptions) {
            const mainFile = zipOptions?.main || 'main';
            const mainNodejs = `${mainFile}.nodejs.js`;
            const pluginMainNodeJs = `/plugin/${mainNodejs}`;
            const pluginIdMainNodeJs = `/${pluginId}/${mainNodejs}`;

            const { clusterId, clusterSecret, zipHash } = zipOptions;
            const { zipFile, unzippedPath } = await prepareZip(getPluginVolume(pluginId), zipHash, getZip);

            const SCRYPTED_CLUSTER_ADDRESS = process.env.SCRYPTED_CLUSTER_ADDRESS;

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

            peer.onProxySerialization = value => onProxySerialization(peer, value, undefined);

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

            // all cluster clients, incoming and outgoing, connect with random ports which can be used as peer ids
            // on the cluster server that is listening on the actual port/
            // incoming connections: use the remote random/unique port
            // outgoing connections: use the local random/unique port
            const clusterPeers = new Map<string, Promise<RpcPeer>>();
            function getClusterPeerKey(address: string, port: number) {
                return `${address}:${port}`;
            }

            const clusterRpcServer = net.createServer(client => {
                const clusterPeerAddress = client.remoteAddress;
                const clusterPeerPort = client.remotePort;
                const clusterPeerKey = getClusterPeerKey(clusterPeerAddress, clusterPeerPort);
                const clusterPeer = createDuplexRpcPeer(peer.selfName, clusterPeerKey, client, client);
                // the listening peer sourceKey (client address/port) is used by the OTHER peer (the client)
                // to determine if it is already connected to THIS peer (the server).
                clusterPeer.onProxySerialization = (value) => onProxySerialization(clusterPeer, value, clusterPeerKey);
                clusterPeers.set(clusterPeerKey, Promise.resolve(clusterPeer));
                startPluginRemoteOptions?.onClusterPeer?.(clusterPeer);
                const connectRPCObject: ConnectRPCObject = async (o) => {
                    const sha256 = computeClusterObjectHash(o, clusterSecret);
                    if (sha256 !== o.sha256)
                        throw new Error('secret incorrect');
                    return resolveObject(o.proxyId, o.sourceKey);
                }
                clusterPeer.params['connectRPCObject'] = connectRPCObject;
                client.on('close', () => {
                    clusterPeers.delete(clusterPeerKey);
                    clusterPeer.kill('cluster socket closed');
                });
            })

            const listenAddress = SCRYPTED_CLUSTER_ADDRESS
                ? '0.0.0.0'
                : '127.0.0.1';
            const clusterPort = await listenZero(clusterRpcServer, listenAddress);

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
                        if (sourceAddress !== SCRYPTED_CLUSTER_ADDRESS && sourceAddress !== '127.0.0.1')
                            console.warn("source address mismatch", sourceAddress);

                        const clusterPeer = createDuplexRpcPeer(peer.selfName, clusterPeerKey, socket, socket);
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

            async function peerConnectRPCObject(peer: RpcPeer, o: ClusterObject) {
                let peerConnectRPCObject: Promise<ConnectRPCObject> = peer.tags['connectRPCObject'];
                if (!peerConnectRPCObject) {
                    peerConnectRPCObject = peer.getParam('connectRPCObject');
                    peer.tags['connectRPCObject'] = peerConnectRPCObject;
                }
                const resolved = await peerConnectRPCObject;
                return resolved(o);
            }

            const tidChannels = new Map<number, Deferred<worker_threads.MessagePort>>();
            const tidPeers = new Map<number, Promise<RpcPeer>>();

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
                    threadPeer.onProxySerialization = value => onProxySerialization(threadPeer, value, threadPeerKey);

                    const connectRPCObject: ConnectRPCObject = async (o) => {
                        const sha256 = computeClusterObjectHash(o, clusterSecret);
                        if (sha256 !== o.sha256)
                            throw new Error('secret incorrect');
                        return resolveObject(o.proxyId, o.sourceKey);
                    }
                    threadPeer.params['connectRPCObject'] = connectRPCObject;

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

            scrypted.connectRPCObject = async (value: any) => {
                const clusterObject: ClusterObject = value?.__cluster;
                if (clusterObject?.id !== clusterId)
                    return value;
                const { address, port, proxyId, sourceKey } = clusterObject;
                // handle the case when trying to connect to an object is on this cluster node,
                // returning the actual object, rather than initiating a loopback connection.
                if (port === clusterPort)
                    return resolveObject(proxyId, sourceKey);

                // can use worker to worker ipc if the address and pid matches and both side are node.
                if (address === SCRYPTED_CLUSTER_ADDRESS && proxyId.startsWith('n-')) {
                    const parts = proxyId.split('-');
                    const pid = parseInt(parts[1]);
                    if (pid === process.pid)
                        return connectIPCObject(clusterObject, parseInt(parts[2]));
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
            if (worker_threads.isMainThread) {
                const fsDir = path.join(unzippedPath, 'fs')
                await fs.promises.mkdir(fsDir, {
                    recursive: true,
                });
                process.chdir(fsDir);
            }

            const pluginReader = (name: string) => {
                const filename = path.join(unzippedPath, name);
                if (!fs.existsSync(filename))
                    return;
                return fs.readFileSync(filename);
            };

            const pluginConsole = getPluginConsole?.();
            params.console = pluginConsole;
            const pnp = getPluginNodePath(pluginId);
            pluginConsole?.log('node modules', pnp);
            params.require = (name: string) => {
                if (name === 'realfs') {
                    return require('fs');
                }
                try {
                    if (name.startsWith('.') && unzippedPath) {
                        try {
                            const c = path.join(unzippedPath, name);
                            const module = require(c);
                            return module;
                        }
                        catch (e) {
                        }
                    }
                    const module = require(name);
                    return module;
                }
                catch (e) {
                    const c = path.join(pnp, 'node_modules', name);
                    return require(c);
                }
            };
            // const window: any = {};
            const exports: any = {};
            // window.exports = exports;
            // params.window = window;
            params.exports = exports;

            const entry = pluginReader(`${mainNodejs}.map`)
            const map = entry?.toString();

            // plugins may install their own sourcemap support during startup, so
            // hook the sourcemap installation after everything is loaded.
            postInstallSourceMapSupport = (scrypted) => {
                process.removeAllListeners('uncaughtException');
                process.removeAllListeners('unhandledRejection');

                process.on('uncaughtException', e => {
                    getPluginConsole().error('uncaughtException', e);
                    scrypted.log.e('uncaughtException ' + (e.stack || e?.toString()));
                });
                process.on('unhandledRejection', e => {
                    getPluginConsole().error('unhandledRejection', e);
                    scrypted.log.e('unhandledRejection ' + ((e as Error).stack || e?.toString()));
                });

                installSourceMapSupport({
                    environment: 'node',
                    retrieveSourceMap(source) {
                        if (source === pluginMainNodeJs || source === pluginIdMainNodeJs) {
                            if (!map)
                                return null;
                            return {
                                url: pluginMainNodeJs,
                                map,
                            }
                        }
                        return null;
                    }
                });
            };

            await installOptionalDependencies(getPluginConsole(), packageJson);

            // process.cpuUsage is for the entire process.
            // process.memoryUsage is per thread.
            const allMemoryStats = new Map<RuntimeWorker, NodeJS.MemoryUsage>();
            // start the stats updater/watchdog after installation has finished, as that may take some time.
            peer.getParam('updateStats').then(updateStats => startStatsUpdater(allMemoryStats, updateStats));

            let pong: (time: number) => Promise<void>;
            peer.params.ping = async (time: number) => {
                pong ||= await peer.getParam('pong');
                await pong(time);
            };

            const main = pluginReader(mainNodejs);
            const script = main.toString();

            scrypted.connect = (socket, options) => {
                process.send(options, socket);
            }

            const pluginRemoteAPI: PluginRemote = scrypted.pluginRemoteAPI;

            scrypted.fork = (options) => {
                let runtimeWorker: RuntimeWorker;
                let nativeWorker: child_process.ChildProcess | worker_threads.Worker;
                if (options?.runtime) {
                    const builtins = getBuiltinRuntimeHosts();
                    const runtime = builtins.get(options.runtime);
                    if (!runtime)
                        throw new Error('unknown runtime ' + options.runtime);
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
                        const console = options?.id ? getMixinConsole(options.id, options.nativeId) : undefined;
                        pipeWorkerConsole(nativeWorker, console);
                    }
                }
                else {
                    // when a node thread is created, also create a secondary message channel to link the grandparent (or mainthread) and child.
                    const mainThreadChannel = new worker_threads.MessageChannel();

                    const ntw = new NodeThreadWorker(mainFilename, pluginId, {
                        packageJson,
                        env: process.env,
                        pluginDebug: undefined,
                        zipFile,
                        unzippedPath,
                        zipHash,
                    }, {
                        name: options?.name,
                    }, {
                        // child connection to grandparent
                        mainThreadPort: mainThreadChannel.port1,
                    }, [mainThreadChannel.port1]);
                    runtimeWorker = ntw;
                    nativeWorker = ntw.worker;

                    const { threadId } = ntw.worker;
                    if (mainThreadPort) {
                        // grandparent connection to child
                        mainThreadPort.postMessage({
                            port: mainThreadChannel.port2,
                            threadId,
                        }, [mainThreadChannel.port2]);
                    }
                    else {
                        mainThreadBrokerRegister(mainThreadChannel.port2, threadId);
                    }
                }

                const result = (async () => {
                    const threadPeer = new RpcPeer('main', 'thread', (message, reject, serializationContext) => runtimeWorker.send(message, reject, serializationContext));
                    threadPeer.params.updateStats = (stats: PluginStats) => {
                        allMemoryStats.set(runtimeWorker, stats.memoryUsage);
                    }
                    runtimeWorker.setupRpcPeer(threadPeer);

                    class PluginForkAPI extends PluginAPIProxy {
                        [RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS] = (api as any)[RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS];

                        setStorage(nativeId: string, storage: { [key: string]: any; }): Promise<void> {
                            const id = deviceManager.nativeIds.get(nativeId).id;
                            pluginRemoteAPI.setNativeId(nativeId, id, storage);
                            for (const r of forks) {
                                if (r === remote)
                                    continue;
                                r.setNativeId(nativeId, id, storage);
                            }
                            return super.setStorage(nativeId, storage);
                        }
                    }
                    const forkApi = new PluginForkAPI(api);

                    const remote = await setupPluginRemote(threadPeer, forkApi, pluginId, { serverVersion }, () => systemManager.getSystemState());
                    forks.add(remote);
                    runtimeWorker.on('exit', () => {
                        threadPeer.kill('worker exited');
                        forkApi.removeListeners();
                        forks.delete(remote);
                        allMemoryStats.delete(runtimeWorker);
                    });
                    runtimeWorker.on('error', e => {
                        threadPeer.kill('worker error ' + e);
                        forkApi.removeListeners();
                        forks.delete(remote);
                        allMemoryStats.delete(runtimeWorker);
                    });

                    for (const [nativeId, dmd] of deviceManager.nativeIds.entries()) {
                        await remote.setNativeId(nativeId, dmd.id, dmd.storage);
                    }

                    const forkOptions = Object.assign({}, zipOptions);
                    forkOptions.fork = true;
                    forkOptions.main = options?.filename;
                    return remote.loadZip(packageJson, getZip, forkOptions)
                })();

                result.catch(() => runtimeWorker.kill());

                const worker: ForkWorker = {
                    on(event: string, listener: (...args: any[]) => void) {
                        return runtimeWorker.on(event as any, listener);
                    },
                    terminate: () => runtimeWorker.kill(),
                    removeListener(event, listener) {
                        return runtimeWorker.removeListener(event as any, listener);
                    },
                    nativeWorker,
                };
                return {
                    worker,
                    result,
                };
            }

            try {
                const filename = zipOptions?.debug ? pluginMainNodeJs : pluginIdMainNodeJs;
                evalLocal(peer, script, startPluginRemoteOptions?.sourceURL?.(filename) || filename, params);

                if (zipOptions?.fork) {
                    // pluginConsole?.log('plugin forked');
                    const fork = exports.fork;
                    const forked = await fork();
                    forked[RpcPeer.PROPERTY_JSON_DISABLE_SERIALIZATION] = true;
                    return forked;
                }

                pluginConsole?.log('plugin loaded');
                let pluginInstance = exports.default;
                // support exporting a plugin class, plugin main function,
                // or a plugin instance
                if (pluginInstance.toString().startsWith('class '))
                    pluginInstance = new pluginInstance();
                if (typeof pluginInstance === 'function')
                    pluginInstance = await pluginInstance();

                replPort = createREPLServer(scrypted, params, pluginInstance);
                postInstallSourceMapSupport(scrypted);

                return pluginInstance;
            }
            catch (e) {
                pluginConsole?.error('plugin failed to start', e);
                throw e;
            }
        }
    }).then(scrypted => {
        systemManager = scrypted.systemManager;
        deviceManager = scrypted.deviceManager as DeviceManagerImpl;
    });

    return peer;
}
