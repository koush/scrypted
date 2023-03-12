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
import { installOptionalDependencies } from './plugin-npm-dependencies';
import { attachPluginRemote, DeviceManagerImpl, PluginReader, setupPluginRemote } from './plugin-remote';
import { PluginStats, startStatsUpdater } from './plugin-remote-stats';
import { createREPLServer } from './plugin-repl';
import { NodeThreadWorker } from './runtime/node-thread-worker';
import crypto from 'crypto';
const { link } = require('linkfs');

const serverVersion = require('../../package.json').version;

export function startPluginRemote(pluginId: string, peerSend: (message: RpcMessage, reject?: (e: Error) => void, serializationContext?: any) => void) {
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

    // process.cpuUsage is for the entire process.
    // process.memoryUsage is per thread.
    const allMemoryStats = new Map<NodeThreadWorker, NodeJS.MemoryUsage>();

    peer.getParam('updateStats').then(updateStats => startStatsUpdater(allMemoryStats, updateStats));

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
            const clusterRpcServer = net.createServer(client => {
                const clusterPeer = createDuplexRpcPeer(peer.selfName, 'cluster-client', client, client);
                const portSecret = crypto.createHash('sha256').update(`${clusterPort}${clusterSecret}`).digest().toString('hex');
                clusterPeer.params['connectRPCObject'] = async (id: string, secret: string) => {
                    if (secret !== portSecret)
                        throw new Error('secret incorrect');
                    return peer.localProxyMap.get(id);
                }
                client.on('close', () => clusterPeer.kill('cluster socket closed'));
            })
            const clusterPort = await listenZero(clusterRpcServer);
            const clusterEntry = {
                id: clusterId,
                port: clusterPort,
            };

            peer.onProxySerialization = (value, proxyId) => {
                const properties = RpcPeer.prepareProxyProperties(value) || {};
                properties.__cluster = {
                    ...clusterEntry,
                    proxyId,
                }
                return properties;
            }

            const clusterPeers = new Map<number, Promise<RpcPeer>>();
            scrypted.connectRPCObject = async (value: any) => {
                const clusterObject = value?.__cluster;
                if (clusterObject?.id !== clusterId)
                    return value;
                const { port, proxyId } = clusterObject;

                let clusterPeerPromise = clusterPeers.get(port);
                if (!clusterPeerPromise) {
                    clusterPeerPromise = (async () => {
                        const socket = net.connect(port);
                        socket.on('close', () => clusterPeers.delete(port));

                        try {
                            await once(socket, 'connect');
                            const ret = createDuplexRpcPeer(peer.selfName, 'cluster-server', socket, socket);
                            return ret;
                        }
                        catch (e) {
                            console.error('failure ipc connect', e);
                            socket.destroy();
                            throw e;
                        }
                    })();
                }

                try {
                    const clusterPeer = await clusterPeerPromise;
                    const connectRPCObject = await clusterPeer.getParam('connectRPCObject');
                    const portSecret = crypto.createHash('sha256').update(`${port}${clusterSecret}`).digest().toString('hex');
                    const newValue = await connectRPCObject(proxyId, portSecret);
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
            params.require = (name: string) => {
                if (name === 'fakefs' || (name === 'fs' && !packageJson.scrypted.realfs)) {
                    return volume;
                }
                if (name === 'realfs') {
                    return require('fs');
                }
                const module = require(name);
                return module;
            };
            const window: any = {};
            const exports: any = window;
            window.exports = exports;
            params.window = window;
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

            const main = pluginReader('main.nodejs.js');
            pluginReader = undefined;
            const script = main.toString();

            scrypted.connect = (socket, options) => {
                process.send(options, socket);
            }

            const forks = new Set<PluginRemote>();

            scrypted.fork = () => {
                const ntw = new NodeThreadWorker(pluginId, {
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
