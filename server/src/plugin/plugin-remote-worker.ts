import { ScryptedStatic, SystemManager } from '@scrypted/types';
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
import { prepareConsoles } from './plugin-console';
import { getPluginNodePath, installOptionalDependencies } from './plugin-npm-dependencies';
import { DeviceManagerImpl, attachPluginRemote, setupPluginRemote } from './plugin-remote';
import { PluginStats, startStatsUpdater } from './plugin-remote-stats';
import { createREPLServer } from './plugin-repl';
import { getPluginVolume } from './plugin-volume';
import { NodeThreadWorker } from './runtime/node-thread-worker';
import { prepareZip } from './runtime/node-worker-common';

const serverVersion = require('../../package.json').version;

export interface StartPluginRemoteOptions {
    onClusterPeer(peer: RpcPeer): void;
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

            const onProxySerialization = (value: any, sourceKey?: string) => {
                const properties = RpcPeer.prepareProxyProperties(value) || {};
                let clusterEntry: ClusterObject = properties.__cluster;

                // ensure globally stable proxyIds.
                const proxyId = clusterEntry?.proxyId || RpcPeer.generateId();

                // if the cluster entry already exists, check if it belongs to this node.
                // if it belongs to this node, the entry must also be for this peer.
                // relying on the liveness/gc of a different peer may cause race conditions.
                if (clusterEntry && clusterPort === clusterEntry.port && sourceKey !== clusterEntry.sourceKey)
                    clusterEntry = undefined;

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
            peer.onProxySerialization = onProxySerialization;

            const resolveObject = async (id: string, sourceKey: string) => {
                const sourcePeer = sourceKey
                    ? await clusterPeers.get(sourceKey)
                    : peer;
                return sourcePeer?.localProxyMap.get(id);
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
                const clusterPeer = createDuplexRpcPeer(peer.selfName, 'cluster-client', client, client);
                const clusterPeerAddress = client.remoteAddress;
                const clusterPeerPort = client.remotePort;
                const clusterPeerKey = getClusterPeerKey(clusterPeerAddress, clusterPeerPort);
                clusterPeer.onProxySerialization = (value) => onProxySerialization(value, clusterPeerKey);
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
                if (!address || address === SCRYPTED_CLUSTER_ADDRESS)
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

                        // the sourceKey is used by peers to determine if they're already connected.
                        const { address: sourceAddress, port: sourcePort } = (socket.address() as net.AddressInfo);
                        if (sourceAddress !== SCRYPTED_CLUSTER_ADDRESS && sourceAddress !== '127.0.0.1')
                            console.warn("source address mismatch", sourceAddress);
                        const sourcePeerKey = getClusterPeerKey(sourceAddress, sourcePort);

                        const clusterPeer = createDuplexRpcPeer(peer.selfName, 'cluster-server', socket, socket);
                        clusterPeer.onProxySerialization = (value) => onProxySerialization(value, sourcePeerKey);
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

            scrypted.connectRPCObject = async (value: any) => {
                const clusterObject: ClusterObject = value?.__cluster;
                if (clusterObject?.id !== clusterId)
                    return value;
                const { address, port, proxyId, sourceKey } = clusterObject;
                // handle the case when trying to connect to an object is on this cluster node,
                // returning the actual object, rather than initiating a loopback connection.
                if (port === clusterPort)
                    return resolveObject(proxyId, sourceKey);

                try {
                    const clusterPeerPromise = ensureClusterPeer(address, port);
                    const clusterPeer = await clusterPeerPromise;
                    // may already have this proxy so check first.
                    const existing = clusterPeer.remoteWeakProxies[proxyId]?.deref();
                    if (existing)
                        return existing;
                    let peerConnectRPCObject: ConnectRPCObject = clusterPeer.tags['connectRPCObject'];
                    if (!peerConnectRPCObject) {
                        peerConnectRPCObject = await clusterPeer.getParam('connectRPCObject');
                        clusterPeer.tags['connectRPCObject'] = peerConnectRPCObject;
                    }
                    const newValue = await peerConnectRPCObject(clusterObject);
                    if (!newValue)
                        throw new Error('rpc object not found?');
                    return newValue;
                }
                catch (e) {
                    console.error('failure rpc', e);
                    return value;
                }
            }
            if (worker_threads.isMainThread) {
                const fsDir = path.join(unzippedPath, 'fs')
                if (fs.existsSync(fsDir))
                    process.chdir(fsDir);
                else
                    process.chdir(unzippedPath);
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
            const allMemoryStats = new Map<NodeThreadWorker, NodeJS.MemoryUsage>();
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
                const ntw = new NodeThreadWorker(mainFilename, pluginId, {
                    packageJson,
                    env: process.env,
                    pluginDebug: undefined,
                    zipFile,
                    unzippedPath,
                    zipHash,
                }, {
                    name: options?.name,
                });

                const result = (async () => {
                    const threadPeer = new RpcPeer('main', 'thread', (message, reject) => ntw.send(message, reject));
                    threadPeer.params.updateStats = (stats: PluginStats) => {
                        allMemoryStats.set(ntw, stats.memoryUsage);
                    }
                    ntw.setupRpcPeer(threadPeer);

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
                    ntw.on('exit', () => {
                        threadPeer.kill('worker exited');
                        forkApi.removeListeners();
                        forks.delete(remote);
                        allMemoryStats.delete(ntw);
                    });
                    ntw.on('error', e => {
                        threadPeer.kill('worker error ' + e);
                        forkApi.removeListeners();
                        forks.delete(remote);
                        allMemoryStats.delete(ntw);
                    });

                    for (const [nativeId, dmd] of deviceManager.nativeIds.entries()) {
                        await remote.setNativeId(nativeId, dmd.id, dmd.storage);
                    }

                    const forkOptions = Object.assign({}, zipOptions);
                    forkOptions.fork = true;
                    return remote.loadZip(packageJson, getZip, forkOptions)
                })();

                result.catch(() => ntw.kill());

                return {
                    worker: ntw.worker,
                    result,
                }
            }

            try {
                const filename = zipOptions?.debug ? pluginMainNodeJs : pluginIdMainNodeJs;
                evalLocal(peer, script, filename, params);

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
