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
            const { clusterId, clusterSecret, zipHash } = zipOptions;
            const { zipFile, unzippedPath } = await prepareZip(getPluginVolume(pluginId), zipHash, getZip);

            const onProxySerialization = (value: any, proxyId: string, sourcePeerPort?: number) => {
                const properties = RpcPeer.prepareProxyProperties(value) || {};
                let clusterEntry: ClusterObject = properties.__cluster;

                // set the cluster identity if it does not exist.
                if (!clusterEntry) {
                    clusterEntry = {
                        id: clusterId,
                        port: clusterPort,
                        proxyId,
                        sourcePort: sourcePeerPort,
                        sha256: null,
                    };
                    clusterEntry.sha256 = computeClusterObjectHash(clusterEntry, clusterSecret);
                    properties.__cluster = clusterEntry;
                }
                // always reassign the id and source.
                // if this is already a p2p object, and is passed to a different peer,
                // a future p2p object must be routed to the correct p2p peer to find the object.
                // clusterEntry.proxyId = proxyId;
                // clusterEntry.source = source;
                return properties;
            }
            peer.onProxySerialization = onProxySerialization;

            const resolveObject = async (id: string, sourcePeerPort: number) => {
                const sourcePeer = sourcePeerPort ? await clusterPeers.get(sourcePeerPort) : peer;
                return sourcePeer?.localProxyMap.get(id);
            }

            // all cluster clients, incoming and outgoing, connect with random ports which can be used as peer ids
            // on the cluster server that is listening on the actual port/
            // incoming connections: use the remote random/unique port
            // outgoing connections: use the local random/unique port
            const clusterPeers = new Map<number, Promise<RpcPeer>>();
            const clusterRpcServer = net.createServer(client => {
                const clusterPeer = createDuplexRpcPeer(peer.selfName, 'cluster-client', client, client);
                const clusterPeerPort = client.remotePort;
                clusterPeer.onProxySerialization = (value, proxyId) => onProxySerialization(value, proxyId, clusterPeerPort);
                clusterPeers.set(clusterPeerPort, Promise.resolve(clusterPeer));
                startPluginRemoteOptions?.onClusterPeer?.(clusterPeer);
                const connectRPCObject: ConnectRPCObject = async (o) => {
                    const sha256 = computeClusterObjectHash(o, clusterSecret);
                    if (sha256 !== o.sha256)
                        throw new Error('secret incorrect');
                    return resolveObject(o.proxyId, o.sourcePort);
                }
                clusterPeer.params['connectRPCObject'] = connectRPCObject;
                client.on('close', () => {
                    clusterPeers.delete(clusterPeerPort);
                    clusterPeer.kill('cluster socket closed');
                });
            })
            const clusterPort = await listenZero(clusterRpcServer, '127.0.0.1');

            const ensureClusterPeer = (connectPort: number) => {
                let clusterPeerPromise = clusterPeers.get(connectPort);
                if (!clusterPeerPromise) {
                    clusterPeerPromise = (async () => {
                        const socket = net.connect(connectPort, '127.0.0.1');
                        socket.on('close', () => clusterPeers.delete(connectPort));

                        try {
                            await once(socket, 'connect');
                            // the sourcePort will be added to all rpc objects created by this peer session and used by resolveObject for later
                            // resolution when trying to find the peer.
                            const sourcePort = (socket.address() as net.AddressInfo).port;

                            const clusterPeer = createDuplexRpcPeer(peer.selfName, 'cluster-server', socket, socket);
                            clusterPeer.tags.localPort = sourcePort;
                            clusterPeer.onProxySerialization = (value, proxyId) => onProxySerialization(value, proxyId, sourcePort);
                            return clusterPeer;
                        }
                        catch (e) {
                            console.error('failure ipc connect', e);
                            socket.destroy();
                            throw e;
                        }
                    })();
                    clusterPeers.set(connectPort, clusterPeerPromise);
                }
                return clusterPeerPromise;
            };

            scrypted.connectRPCObject = async (value: any) => {
                const clusterObject: ClusterObject = value?.__cluster;
                if (clusterObject?.id !== clusterId)
                    return value;
                const { port, proxyId, sourcePort } = clusterObject;
                // handle the case when trying to connect to an object is on this cluster node,
                // returning the actual object, rather than initiating a loopback connection.
                if (port === clusterPort)
                    return resolveObject(proxyId, sourcePort);

                try {
                    const clusterPeerPromise = ensureClusterPeer(port);
                    const clusterPeer = await clusterPeerPromise;
                    // if the localPort is the sourcePort, that means the rpc object already exists as it originated from this node.
                    // so return the existing proxy.
                    if (clusterPeer.tags.localPort === sourcePort)
                        return value;
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

            const entry = pluginReader('main.nodejs.js.map')
            const map = entry?.toString();

            // plugins may install their own sourcemap support during startup, so
            // hook the sourcemap installation after everything is loaded.
            postInstallSourceMapSupport = (scrypted) => {
                process.removeAllListeners('uncaughtException');
                process.removeAllListeners('unhandledRejection');

                process.on('uncaughtException', e => {
                    getPluginConsole().error('uncaughtException', e);
                    scrypted.log.e('uncaughtException ' + e?.toString());
                });
                process.on('unhandledRejection', e => {
                    getPluginConsole().error('unhandledRejection', e);
                    scrypted.log.e('unhandledRejection ' + e?.toString());
                });

                installSourceMapSupport({
                    environment: 'node',
                    retrieveSourceMap(source) {
                        if (source === '/plugin/main.nodejs.js' || source === `/${pluginId}/main.nodejs.js`) {
                            if (!map)
                                return null;
                            return {
                                url: '/plugin/main.nodejs.js',
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

            const main = pluginReader('main.nodejs.js');
            const script = main.toString();

            scrypted.connect = (socket, options) => {
                process.send(options, socket);
            }

            const pluginRemoteAPI: PluginRemote = scrypted.pluginRemoteAPI;

            scrypted.fork = () => {
                const ntw = new NodeThreadWorker(mainFilename, pluginId, {
                    packageJson,
                    env: process.env,
                    pluginDebug: undefined,
                    zipFile,
                    unzippedPath,
                    zipHash,
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
                    ntw.worker.on('exit', () => {
                        threadPeer.kill('worker exited');
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
                const filename = zipOptions?.debug ? '/plugin/main.nodejs.js' : `/${pluginId}/main.nodejs.js`;
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
