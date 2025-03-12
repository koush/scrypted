import type { ForkWorker, ScryptedStatic, SystemManager } from '@scrypted/types';
import child_process from 'child_process';
import fs from 'fs';
import path from 'path';
import { install as installSourceMapSupport } from 'source-map-support';
import worker_threads from 'worker_threads';
import { utilizesClusterForkWorker } from '../cluster/cluster-labels';
import { getScryptedClusterMode, setupCluster } from '../cluster/cluster-setup';
import { RpcMessage, RpcPeer } from '../rpc';
import { evalLocal } from '../rpc-peer-eval';
import type { PluginComponent } from '../services/plugin';
import { ClusterManagerImpl } from './cluster';
import type { DeviceManagerImpl } from './device';
import { MediaManagerImpl } from './media';
import { PluginAPI, PluginAPIProxy, PluginRemote, PluginRemoteLoadZipOptions, PluginZipAPI } from './plugin-api';
import { pipeWorkerConsole, prepareConsoles } from './plugin-console';
import { getPluginNodePath, installOptionalDependencies } from './plugin-npm-dependencies';
import { attachPluginRemote, setupPluginRemote } from './plugin-remote';
import { createREPLServer } from './plugin-repl';
import { getPluginVolume } from './plugin-volume';
import { ChildProcessWorker } from './runtime/child-process-worker';
import { createClusterForkWorker } from './runtime/cluster-fork-worker';
import { NodeThreadWorker } from './runtime/node-thread-worker';
import { prepareZip } from './runtime/node-worker-common';
import { getBuiltinRuntimeHosts } from './runtime/runtime-host';
import { RuntimeWorker, RuntimeWorkerOptions } from './runtime/runtime-worker';
import { Deferred } from '../deferred';

const serverVersion = require('../../package.json').version;

let scryptedStatic: ScryptedStatic;
export function getScryptedStatic() {
    return scryptedStatic;
}

export interface StartPluginRemoteOptions {
    sourceURL?(filename: string): string;
    consoleId?: string;
}

export function startPluginRemote(mainFilename: string, pluginId: string, peerSend: (message: RpcMessage, reject?: (e: Error) => void, serializationContext?: any) => void, startPluginRemoteOptions?: StartPluginRemoteOptions) {
    const peer = new RpcPeer('unknown', 'host', peerSend);

    const clusterPeerSetup = setupCluster(peer);
    const { initializeCluster, connectRPCObject, mainThreadBrokerRegister, mainThreadPort } = clusterPeerSetup;

    peer.params.initializeCluster = initializeCluster;
    peer.params.ping = async (time: number) => {
        return time;
    };

    let systemManager: SystemManager;
    let deviceManager: DeviceManagerImpl;
    let api: PluginAPI;

    let pluginsPromise: Promise<PluginComponent>;
    function getPlugins() {
        pluginsPromise ||= api.getComponent('plugins');
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
        async getServicePort(name) {
            if (name === 'repl') {
                if (!replPort)
                    throw new Error('REPL unavailable: Plugin not loaded.')
                return [await replPort, process.env.SCRYPTED_CLUSTER_ADDRESS];
            }
            throw new Error(`unknown service ${name}`);
        },
        async onLoadZip(scrypted: ScryptedStatic, params: any, packageJson: any, zipAPI: PluginZipAPI, zipOptions: PluginRemoteLoadZipOptions) {
            const mainFile = zipOptions?.main || 'main';
            const mainNodejs = `${mainFile}.nodejs.js`;
            const pluginMainNodeJs = `/plugin/${mainNodejs}`;
            const pluginIdMainNodeJs = `/${pluginId}/${mainNodejs}`;

            const { zipHash } = zipOptions;
            // todo: fix rpc method call, passing zipAPI.getZip directly should work.
            const { zipFile, unzippedPath } = await prepareZip(getPluginVolume(pluginId), zipHash, () => zipAPI.getZip());

            await initializeCluster(zipOptions);

            scrypted.connectRPCObject = connectRPCObject;
            scrypted.clusterManager = new ClusterManagerImpl(getScryptedClusterMode()?.[0], api, zipOptions.clusterWorkerId);

            if (worker_threads.isMainThread) {
                const fsDir = path.join(unzippedPath, 'fs')
                await fs.promises.mkdir(fsDir, {
                    recursive: true,
                });
                process.chdir(fsDir);
            }

            const pluginReader = async (name: string) => {
                const filename = path.join(unzippedPath, name);
                return await fs.promises.readFile(filename).catch(() => { }) || undefined;
            };

            const pluginConsole = getPluginConsole?.();
            params.console = pluginConsole;

            const pnp = getPluginNodePath(pluginId);
            // const pnpNodeModules = path.join(pnp, 'node_modules');
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
            // this breaks relative imports, which currently arent in use i think.
            // params.require = createRequire(pnpNodeModules);

            params.module = {
                exports: {},
            };
            params.exports = params.module.exports;

            const entry = await pluginReader(`${mainNodejs}.map`)
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

            const main = await pluginReader(mainNodejs);
            const script = main.toString();

            scrypted.connect = (socket, options) => {
                process.send(options, socket);
            }

            const pluginRemoteAPI: PluginRemote = scrypted.pluginRemoteAPI;

            scrypted.fork = (options) => {
                let forkPeer: Promise<RpcPeer>;
                let runtimeWorker: RuntimeWorker;
                let nativeWorker: child_process.ChildProcess | worker_threads.Worker;
                let clusterWorkerId: Promise<string>;

                const runtimeWorkerOptions: RuntimeWorkerOptions = {
                    packageJson,
                    env: undefined,
                    pluginDebug: undefined,
                    zipFile,
                    unzippedPath,
                    zipHash,
                };

                // if running in a cluster, fork to a matching cluster worker only if necessary.
                if (utilizesClusterForkWorker(options)) {
                    ({ runtimeWorker, forkPeer, clusterWorkerId } = createClusterForkWorker(
                        runtimeWorkerOptions,
                        options,
                        api.getComponent('cluster-fork'),
                        () => zipAPI.getZip(),
                        scrypted.connectRPCObject)
                    );
                }
                else {
                    if (options?.runtime) {
                        const builtins = getBuiltinRuntimeHosts();
                        const runtime = builtins.get(options.runtime);
                        if (!runtime)
                            throw new Error('unknown runtime ' + options.runtime);
                        runtimeWorker = runtime(mainFilename, runtimeWorkerOptions, undefined);

                        if (runtimeWorker instanceof ChildProcessWorker) {
                            nativeWorker = runtimeWorker.childProcess;
                        }
                    }
                    else {
                        // when a node thread is created, also create a secondary message channel to link the grandparent (or mainthread) and child.
                        const mainThreadChannel = new worker_threads.MessageChannel();

                        const ntw = new NodeThreadWorker(mainFilename, pluginId, {
                            packageJson,
                            env: undefined,
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

                    const localPeer = new RpcPeer('main', 'thread', (message, reject, serializationContext) => runtimeWorker.send(message, reject, serializationContext));
                    runtimeWorker.setupRpcPeer(localPeer);
                    forkPeer = Promise.resolve(localPeer);
                }

                const exitDeferred = new Deferred<string>();
                runtimeWorker.on('exit', () => {
                    exitDeferred.resolve('worker exited');
                });
                runtimeWorker.on('error', e => {
                    exitDeferred.resolve('worker error' + e);
                });

                // thread workers inherit main console. pipe anything else.
                if (!(runtimeWorker instanceof NodeThreadWorker)) {
                    const console = options?.id ? getMixinConsole(options.id, options.nativeId) : undefined;
                    pipeWorkerConsole(runtimeWorker, console);
                }

                const result = (async () => {
                    const threadPeer = await forkPeer;
                    exitDeferred.promise.then(reason => {
                        threadPeer.kill(reason);
                    });

                    // todo: handle nested forks and skip wrap. this is probably buggy.
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
                    exitDeferred.promise.then(reason => {
                        forkApi.removeListeners();
                        forks.delete(remote);
                    });

                    for (const [nativeId, dmd] of deviceManager.nativeIds.entries()) {
                        await remote.setNativeId(nativeId, dmd.id, dmd.storage);
                    }

                    const forkOptions = Object.assign({}, zipOptions);
                    forkOptions.clusterWorkerId = await clusterWorkerId || forkOptions.clusterWorkerId;
                    forkOptions.fork = true;
                    forkOptions.main = options?.filename;
                    const forkZipAPI = new PluginZipAPI(() => zipAPI.getZip());
                    return remote.loadZip(packageJson, forkZipAPI, forkOptions)
                })();

                result.catch(() => runtimeWorker.kill());

                const worker: ForkWorker = {
                    [Symbol.dispose]() {
                        worker.terminate();
                    },
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
                    [Symbol.dispose]() {
                        worker.terminate();
                    },
                    clusterWorkerId,
                    worker,
                    result,
                };
            }

            try {
                const isModule = packageJson.type === 'module';
                const filename = zipOptions?.debug ? pluginMainNodeJs : pluginIdMainNodeJs;
                const sdkVersion = await pluginReader('sdk.json').then(b => JSON.parse(b.toString()).version).catch(() => { });
                const mainNodeJsOnFilesystem = path.join(unzippedPath, mainNodejs);
                if (sdkVersion) {
                    // todo: remove this, only existed in prerelease versions
                    process.env.SCRYPTED_SDK_MODULE = __filename;
                    scryptedStatic = scrypted;
                    globalThis.localStorage = params.localStorage;
                }

                if (isModule) {
                    process.env.SCRYPTED_SDK_ES_MODULE = __filename;
                    const module = await import(mainNodeJsOnFilesystem);
                    params.module.exports = module;
                }
                else if (sdkVersion) {
                    process.env.SCRYPTED_SDK_CJS_MODULE = __filename;
                    params.module.exports = require(mainNodeJsOnFilesystem);
                }
                else {
                    evalLocal(peer, script, startPluginRemoteOptions?.sourceURL?.(filename) || filename, params);
                }

                const exports = params.module.exports;

                if (zipOptions?.fork) {
                    // pluginConsole?.log('plugin forked');
                    const fork = exports.fork;
                    const forked = await fork();
                    forked[RpcPeer.PROPERTY_JSON_DISABLE_SERIALIZATION] = true;
                    return forked;
                }

                pluginConsole?.log('plugin loaded');
                let pluginInstance = exports.default || exports;
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
