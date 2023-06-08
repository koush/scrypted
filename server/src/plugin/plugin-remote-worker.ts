import { ScryptedStatic, SystemManager } from '@scrypted/types';
import AdmZip from 'adm-zip';
import { once } from 'events';
import fs from 'fs';
import { Volume } from 'memfs';
import net from 'net';
import path from 'path';
import { install as installSourceMapSupport } from 'source-map-support';
import { listenZero } from '../listen-zero';
import { RpcMessage, RpcPeer } from '../rpc';
import { createDuplexRpcPeer } from '../rpc-serializer';
import { MediaManagerImpl } from './media';
import { PluginAPI, PluginAPIProxy, PluginRemote, PluginRemoteLoadZipOptions } from './plugin-api';
import { prepareConsoles } from './plugin-console';
import { getPluginNodePath, installOptionalDependencies } from './plugin-npm-dependencies';
import { attachPluginRemote, DeviceManagerImpl, PluginReader, setupPluginRemote } from './plugin-remote';
import { PluginStats, startStatsUpdater } from './plugin-remote-stats';
import { createREPLServer } from './plugin-repl';
import { NodeThreadWorker } from './runtime/node-thread-worker';
import crypto from 'crypto';
const { link } = require('linkfs');

const serverVersion = require('../../package.json').version;

export interface StartPluginRemoteOptions {
    onClusterPeer(peer: RpcPeer): void;
}

interface ClusterObject {
    id: string;
    port: number;
    proxyId: string;
    source: number;
}

type ConnectRPCObject = (id: string, secret: string, sourcePeerPort: number) => Promise<any>;

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

    attachPluginRemote(peer, {
        createMediaManager: async (sm, dm) => {
            systemManager = sm;
            deviceManager = dm
            return new MediaManagerImpl(systemManager, dm);
        },
        onGetRemote: async (_api, _pluginId) => {
            api = _api;
            peer.selfName = pluginId;
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
        async onLoadZip(scrypted: ScryptedStatic, params: any, packageJson: any, zipData: Buffer | string, zipOptions: PluginRemoteLoadZipOptions) {
            const { clusterId, clusterSecret } = zipOptions;

            const onProxySerialization = (value: any, proxyId: string, source?: number) => {
                const properties = RpcPeer.prepareProxyProperties(value) || {};
                let clusterEntry: ClusterObject = properties.__cluster;

                // set the cluster identity if it does not exist.
                if (!clusterEntry) {
                    clusterEntry = {
                        id: clusterId,
                        port: clusterPort,
                        proxyId,
                        source,
                    };
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
                const portSecret = crypto.createHash('sha256').update(`${clusterPort}${clusterSecret}`).digest().toString('hex');
                const connectRPCObject: ConnectRPCObject = async (id, secret, sourcePeerPort) => {
                    if (secret !== portSecret)
                        throw new Error('secret incorrect');
                    return resolveObject(id, sourcePeerPort);
                }
                clusterPeer.params['connectRPCObject'] = connectRPCObject;
                client.on('close', () => {
                    clusterPeers.delete(clusterPeerPort);
                    clusterPeer.kill('cluster socket closed');
                });
            })
            const clusterPort = await listenZero(clusterRpcServer);

            const ensureClusterPeer = (port: number) => {
                let clusterPeerPromise = clusterPeers.get(port);
                if (!clusterPeerPromise) {
                    clusterPeerPromise = (async () => {
                        const socket = net.connect(port, '127.0.0.1');
                        socket.on('close', () => clusterPeers.delete(port));

                        try {
                            await once(socket, 'connect');
                            const clusterPeerPort = (socket.address() as net.AddressInfo).port;

                            const clusterPeer = createDuplexRpcPeer(peer.selfName, 'cluster-server', socket, socket);
                            clusterPeer.tags.localPort = clusterPeerPort;
                            clusterPeer.onProxySerialization = (value, proxyId) => onProxySerialization(value, proxyId, clusterPeerPort);
                            return clusterPeer;
                        }
                        catch (e) {
                            console.error('failure ipc connect', e);
                            socket.destroy();
                            throw e;
                        }
                    })();
                    clusterPeers.set(port, clusterPeerPromise);
                }
                return clusterPeerPromise;
            };

            scrypted.connectRPCObject = async (value: any) => {
                const clusterObject: ClusterObject = value?.__cluster;
                if (clusterObject?.id !== clusterId)
                    return value;
                const { port, proxyId, source } = clusterObject;
                if (port === clusterPort)
                    return resolveObject(proxyId, source);

                try {
                    const clusterPeerPromise = ensureClusterPeer(port);
                    const clusterPeer = await clusterPeerPromise;
                    // this object is already connected
                    if (clusterPeer.tags.localPort === source)
                        return value;
                    const connectRPCObject: ConnectRPCObject = await clusterPeer.getParam('connectRPCObject');
                    const portSecret = crypto.createHash('sha256').update(`${port}${clusterSecret}`).digest().toString('hex');
                    const newValue = await connectRPCObject(proxyId, portSecret, source);
                    if (!newValue)
                        throw new Error('ipc object not found?');
                    return newValue;
                }
                catch (e) {
                    console.error('failure ipc', e);
                    return value;
                }
            }

            let volume: any;
            let pluginReader: PluginReader;
            if (zipOptions?.unzippedPath && fs.existsSync(zipOptions?.unzippedPath)) {
                volume = link(fs, ['', path.join(zipOptions.unzippedPath, 'fs')]);
                pluginReader = name => {
                    const filename = path.join(zipOptions.unzippedPath, name);
                    if (!fs.existsSync(filename))
                        return;
                    return fs.readFileSync(filename);
                };
            }
            else {
                const admZip = new AdmZip(zipData);
                volume = new Volume();
                for (const entry of admZip.getEntries()) {
                    if (entry.isDirectory)
                        continue;
                    if (!entry.entryName.startsWith('fs/'))
                        continue;
                    const name = entry.entryName.substring('fs/'.length);
                    volume.mkdirpSync(path.dirname(name));
                    const data = entry.getData();
                    volume.writeFileSync(name, data);
                }

                pluginReader = name => {
                    const entry = admZip.getEntry(name);
                    if (!entry)
                        return;
                    return entry.getData();
                }
            }
            zipData = undefined;

            const pluginConsole = getPluginConsole?.();
            params.console = pluginConsole;
            const pnp = getPluginNodePath(pluginId);
            pluginConsole?.log('node modules', pnp);
            params.require = (name: string) => {
                if (name === 'fakefs' || (name === 'fs' && !packageJson.scrypted.realfs)) {
                    return volume;
                }
                if (name === 'realfs') {
                    return require('fs');
                }
                try {
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

            const main = pluginReader('main.nodejs.js');
            pluginReader = undefined;
            const script = main.toString();

            scrypted.connect = (socket, options) => {
                process.send(options, socket);
            }

            const forks = new Set<PluginRemote>();

            scrypted.fork = () => {
                const ntw = new NodeThreadWorker(mainFilename, pluginId, {
                    packageJson,
                    env: process.env,
                    pluginDebug: undefined,
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
                            (scrypted.pluginRemoteAPI as PluginRemote).setNativeId(nativeId, id, storage);
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
                    return remote.loadZip(packageJson, zipData, forkOptions)
                })();

                result.catch(() => ntw.kill());

                return {
                    worker: ntw.worker,
                    result,
                }
            }

            try {
                peer.evalLocal(script, zipOptions?.filename || '/plugin/main.nodejs.js', params);

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
