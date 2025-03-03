import { Device, EngineIOHandler, ScryptedInterface } from '@scrypted/types';
import crypto, { scrypt } from 'crypto';
import * as io from 'engine.io';
import fs from 'fs';
import os from 'os';
import { PassThrough } from 'stream';
import WebSocket from 'ws';
import { utilizesClusterForkWorker } from '../cluster/cluster-labels';
import { setupCluster } from '../cluster/cluster-setup';
import { Plugin } from '../db-types';
import { IOServer, IOServerSocket } from '../io';
import type { LogEntry, Logger } from '../logger';
import { RpcPeer, RPCResultError } from '../rpc';
import { createRpcSerializer } from '../rpc-serializer';
import { ScryptedRuntime } from '../runtime';
import { serverVersion } from '../services/info';
import { sleep } from '../sleep';
import { AccessControls } from './acl';
import { MediaManagerHostImpl } from './media';
import { PluginAPIProxy, PluginRemote, PluginRemoteLoadZipOptions, PluginZipAPI } from './plugin-api';
import { ConsoleServer, createConsoleServer } from './plugin-console';
import { PluginDebug } from './plugin-debug';
import { PluginHostAPI } from './plugin-host-api';
import { LazyRemote } from './plugin-lazy-remote';
import { setupPluginRemote } from './plugin-remote';
import { WebSocketConnection } from './plugin-remote-websocket';
import { ensurePluginVolume, getScryptedVolume } from './plugin-volume';
import { createClusterForkWorker } from './runtime/cluster-fork-worker';
import { prepareZipSync } from './runtime/node-worker-common';
import type { RuntimeWorker, RuntimeWorkerOptions } from './runtime/runtime-worker';
import { ClusterForkOptions } from '../scrypted-cluster-main';
export class UnsupportedRuntimeError extends Error {
    constructor(runtime: string) {
        super(`Unsupported runtime: ${runtime}`);
    }
}

export class PluginHost {
    worker: RuntimeWorker;
    peer: RpcPeer;
    pluginId: string;
    module: Promise<any>;
    scrypted: ScryptedRuntime;
    remote: PluginRemote;
    io: IOServer = new io.Server({
        // object detection drag drop 4k can be massive.
        // streaming support somehow?
        maxHttpBufferSize: 20000000,
        pingTimeout: 120000,
        perMessageDeflate: true,
        cors: (req, callback) => {
            const header = this.scrypted.getAccessControlAllowOrigin(req.headers);
            callback(undefined, {
                origin: header,
                credentials: true,
            })
        },
    });
    ws: { [id: string]: WebSocket } = {};
    api: PluginHostAPI;
    pluginName: string;
    packageJson: any;
    killed = false;
    consoleServer: Promise<ConsoleServer>;
    zipHash: string;
    zipFile: string;
    unzippedPath: string;
    clusterWorkerId: Promise<string>;

    kill() {
        this.killed = true;
        this.api.removeListeners();
        this.peer.kill('plugin killed');
        this.worker.kill();
        this.io.close();
        for (const s of Object.values(this.ws)) {
            s.close();
        }
        this.ws = {};

        this.scrypted.invalidatePluginMixins(this.pluginId);

        this.consoleServer.then(server => server.destroy());
    }

    toString() {
        return this.pluginName || 'no plugin name';
    }

    async upsertDevice(upsert: Device) {
        const newDevice = !this.scrypted.findPluginDevice(this.pluginId, upsert.nativeId);
        const { pluginDevicePromise, interfacesChanged } = this.scrypted.upsertDevice(this.pluginId, upsert);
        const pi = await pluginDevicePromise;
        if (newDevice)
            await this.remote.setNativeId(pi.nativeId, pi._id, pi.storage || {});
        // fetch a new device instance if the descriptor changed.
        // plugin may return the same instance.
        // this avoids device and mixin churn.
        // do this on next tick, after this call has returned an id, so the plugin can handle
        // any subsequent requests.
        process.nextTick(async () => {
            let needInvalidate = interfacesChanged || upsert.refresh;
            if (!needInvalidate) {
                // may also need to invalidate if the the plugin did not previously return a device
                // because it had not yet completed the discovery process.
                const device = this.scrypted.devices[pi._id];
                try {
                    if (device.handler?.mixinTable)
                        needInvalidate = !(await device.handler.mixinTable?.[device.handler.mixinTable.length - 1].entry).proxy;
                }
                catch (e) {
                    // device retrieval had previously failed, fetch again.
                    needInvalidate = true;
                }
            }
            if (needInvalidate)
                this.scrypted.invalidatePluginDevice(pi._id);
        });
        return pi._id;
    }

    constructor(scrypted: ScryptedRuntime, plugin: Plugin, pluginDebug?: PluginDebug) {
        this.scrypted = scrypted;
        this.pluginId = plugin._id;
        this.pluginName = plugin.packageJson?.name;
        this.packageJson = plugin.packageJson;

        const pluginDeviceId = scrypted.findPluginDevice(this.pluginId)._id;
        const logger = scrypted.getDeviceLogger(scrypted.findPluginDevice(this.pluginId));

        const volume = getScryptedVolume();
        const pluginVolume = ensurePluginVolume(this.pluginId);

        {
            const zipBuffer = Buffer.from(plugin.zip, 'base64');
            // allow garbage collection of the base 64 contents
            plugin = undefined;
            const hash = crypto.createHash('md5').update(zipBuffer).digest().toString('hex');
            this.zipHash = hash;

            const { zipFile, unzippedPath } = prepareZipSync(pluginVolume, hash, () => zipBuffer);
            this.zipFile = zipFile;
            this.unzippedPath = unzippedPath;
        }

        const peerPromise = this.startPluginHost(logger, {
            SCRYPTED_VOLUME: volume,
            SCRYPTED_PLUGIN_VOLUME: pluginVolume,
        }, pluginDebug);

        this.io.on('connection', async (socket) => {
            try {
                const {
                    accessControls,
                    endpointRequest,
                    pluginDevice,
                } = (socket.request as any).scrypted;

                try {
                    if (socket.request.url.indexOf('/engine.io/api') !== -1) {
                        if (socket.request.url.indexOf('/public') !== -1) {
                            socket.close();
                            return;
                        }

                        await this.createRpcIoPeer(socket, accessControls);
                        return;
                    }
                }
                catch (e) {
                    socket.close();
                    return;
                }

                const handler = this.scrypted.getDevice<EngineIOHandler>(pluginDevice._id);

                // @ts-expect-error
                const id = socket.id;

                socket.on('message', message => {
                    this.remote.ioEvent(id, 'message', message)
                });
                socket.on('close', reason => {
                    this.remote.ioEvent(id, 'close');
                });

                // @ts-expect-error
                await handler.onConnection(endpointRequest, new WebSocketConnection(`io://${id}`, {
                    send(message) {
                        socket.send(message);
                    },
                    close(message) {
                        socket.close();
                    },
                }));
            }
            catch (e) {
                console.error('engine.io plugin error', e);
                socket.close();
            }
        })

        const { runtime } = this.packageJson.scrypted;
        const mediaManager = runtime && runtime !== 'node'
            ? new MediaManagerHostImpl(pluginDeviceId, () => scrypted.stateManager.getSystemState(), console, id => scrypted.getDevice(id))
            : undefined;

        this.api = new PluginHostAPI(scrypted, this.pluginId, this, mediaManager);

        logger.log('i', `loading ${this.pluginName}`);
        logger.log('i', 'pid ' + this.worker?.pid);

        const remotePromise = this.prepareRemote(peerPromise, logger, pluginDebug);
        const init = this.initializeRemote(remotePromise, logger, pluginDebug);

        init.catch(e => {
            console.error('plugin failed to load', e);
            this.api.removeListeners();
        });

        this.module = init.then(({ module }) => module);
        const remote = init.then(({ remote }) => remote);
        this.remote = new LazyRemote(remotePromise, remote);
    }

    private async initializeRemote(remotePromise: Promise<PluginRemote>, logger: Logger, pluginDebug: PluginDebug) {
        const remote = await remotePromise;

        await Promise.all(
            this.scrypted.findPluginDevices(this.pluginId)
                .map(pluginDevice => remote.setNativeId(pluginDevice.nativeId, pluginDevice._id, pluginDevice.storage || {}))
        );

        const waitDebug = pluginDebug?.waitDebug;
        if (waitDebug) {
            console.info('waiting for debugger...');
            try {
                await waitDebug;
                console.info('debugger attached.');
                await sleep(1000);
            }
            catch (e) {
                console.error('debugger failed', e);
            }
        }

        const fail = 'Plugin failed to load. View Console for more information.';
        try {
            const loadZipOptions: PluginRemoteLoadZipOptions = {
                clusterId: this.scrypted.clusterId,
                clusterSecret: this.scrypted.clusterSecret,
                clusterWorkerId: await this.clusterWorkerId,
                // debug flag can be used to affect path resolution for sourcemaps etc.
                debug: !!pluginDebug,
                zipHash: this.zipHash,
            };
            // original implementation sent the zipBuffer, sending the zipFile name now.
            // can switch back for non-local plugins.
            const modulePromise = remote.loadZip(this.packageJson,
                new PluginZipAPI(async () => fs.promises.readFile(this.zipFile)),
                loadZipOptions);
            // allow garbage collection of the zip buffer
            const module = await modulePromise;
            logger.log('i', `loaded ${this.pluginName}`);
            logger.clearAlert(fail)
            return { module, remote };
        }
        catch (e) {
            logger.log('a', fail);
            logger.log('e', `plugin load error ${e}`);
            console.error('plugin load error', e);
            throw e;
        }
    }

    private async prepareRemote(peerPromise: Promise<RpcPeer>, logger: Logger, pluginDebug: PluginDebug) {
        let peer: RpcPeer;
        try {
            peer = await peerPromise;
        }
        catch (e) {
            logger.log('e', 'plugin failed to start ' + e);
            throw new RPCResultError(this.peer, 'cluster plugin start failed', e);
        }

        const startupTime = Date.now();
        let lastPong: number;

        (async () => {
            try {
                let pingPromise: Promise<(time: number) => Promise<number>>
                while (!this.killed) {
                    await sleep(30000);
                    if (this.killed)
                        return;
                    pingPromise ||= peer.getParam('ping');
                    const ping = await pingPromise;
                    lastPong = await ping(Date.now());
                }
            }
            catch (e) {
                logger.log('e', 'plugin ping failed. restarting.');
                this.api.requestRestart();
            }
        })();

        const healthInterval = setInterval(async () => {
            const now = Date.now();
            // plugin may take a while to install, so wait 10 minutes.
            // after that, require 1 minute checkins.
            if (!lastPong) {
                if (now - startupTime > 10 * 60 * 1000) {
                    const logger = await this.api.getLogger(undefined);
                    logger.log('e', 'plugin failed to start in a timely manner. restarting.');
                    this.api.requestRestart();
                }
                return;
            }
            if (!pluginDebug && (lastPong + 60000 < now)) {
                const logger = await this.api.getLogger(undefined);
                logger.log('e', 'plugin is not responding to ping. restarting.');
                this.api.requestRestart();
            }
        }, 60000);
        peer.killedSafe.finally(() => clearInterval(healthInterval));

        return setupPluginRemote(peer, this.api, this.pluginId, { serverVersion }, () => this.scrypted.stateManager.getSystemState());
    }

    startPluginHost(logger: Logger, env: any, pluginDebug: PluginDebug) {
        let connected = true;

        let { runtime } = this.packageJson.scrypted;
        runtime ||= 'node';

        const pluginDevice = this.scrypted.findPluginDevice(this.pluginId);
        const customRuntime = pluginDevice.state.interfaces.value.includes(ScryptedInterface.ScryptedPluginRuntime);
        if (customRuntime) {
            runtime = 'custom';
        }

        const workerHost = this.scrypted.pluginHosts.get(runtime);
        if (!workerHost)
            throw new UnsupportedRuntimeError(this.packageJson.scrypted.runtime);

        let peer: Promise<RpcPeer>;
        const runtimeWorkerOptions: RuntimeWorkerOptions = {
            packageJson: this.packageJson,
            env,
            pluginDebug,
            unzippedPath: this.unzippedPath,
            zipFile: this.zipFile,
            zipHash: this.zipHash,
        };

        if (
            // check if the plugin requests a cluster worker in the package json
            !utilizesClusterForkWorker(this.packageJson.scrypted) &&
            // check if there is a cluster worker that is specifically labelled for a non cluster-aware plugin
            ![...this.scrypted.clusterWorkers.values()].find(cw => cw.labels.includes(this.pluginId))) {
            this.peer = new RpcPeer('host', this.pluginId, (message, reject, serializationContext) => {
                if (connected) {
                    this.worker.send(message, reject, serializationContext);
                }
                else if (reject) {
                    reject(new Error('peer disconnected'));
                }
            });

            peer = Promise.resolve(this.peer);

            this.worker = workerHost(this.scrypted.mainFilename, runtimeWorkerOptions, this.scrypted);

            this.worker.setupRpcPeer(this.peer);

            this.worker.stdout.on('data', data => console.log(data.toString()));
            this.worker.stderr.on('data', data => console.error(data.toString()));
            this.clusterWorkerId = Promise.resolve(undefined);
        }
        else {
            const scrypted: ClusterForkOptions = JSON.parse(JSON.stringify(this.packageJson.scrypted));
            scrypted.labels ||= {};
            scrypted.labels.prefer ||= [];
            scrypted.labels.prefer.push(this.pluginId);

            this.peer = new RpcPeer('host', this.pluginId, (message, reject, serializationContext) => {
                if (connected) {
                    console.warn('unexpected message to cluster fork worker', message);
                }
                else if (reject) {
                    reject(new Error('peer disconnected'));
                }
            });

            const clusterSetup = setupCluster(this.peer);
            const { runtimeWorker, forkPeer, clusterWorkerId } = createClusterForkWorker(
                runtimeWorkerOptions,
                scrypted,
                (async () => {
                    await clusterSetup.initializeCluster({
                        clusterId: this.scrypted.clusterId,
                        clusterSecret: this.scrypted.clusterSecret,
                        clusterWorkerId: this.scrypted.serverClusterWorkerId,
                    });
                    return this.scrypted.clusterFork;
                })(),
                async () => fs.promises.readFile(this.zipFile),
                clusterSetup.connectRPCObject);

            forkPeer.then(peer => {
                const originalPeer = this.peer;
                originalPeer.killedSafe.finally(() => peer.kill());
                this.peer = peer;
                peer.killedSafe.finally(() => originalPeer.kill());
            }).catch(() => { });

            this.clusterWorkerId = clusterWorkerId;
            clusterWorkerId.then(clusterWorkerId => {
                console.log('cluster worker id', clusterWorkerId);
            }).catch(() => {
                console.warn("cluster worker id failed", clusterWorkerId);
            });

            this.worker = runtimeWorker;
            peer = forkPeer;
        }

        let consoleHeader = `${os.platform()} ${os.arch()} ${os.version()}\nserver version: ${serverVersion}\nplugin version: ${this.pluginId} ${this.packageJson.version}\n`;
        if (process.env.SCRYPTED_DOCKER_FLAVOR)
            consoleHeader += `${process.env.SCRYPTED_DOCKER_FLAVOR}\n`;
        const ptout = new PassThrough();
        const pterr = new PassThrough();
        this.worker.stdout.pipe(ptout);
        this.worker.stderr.pipe(pterr);
        this.consoleServer = createConsoleServer(ptout, pterr, consoleHeader);
        logger.on('log', (entry: LogEntry) => {
            switch (entry.level) {
                case 'e':
                case 'w':
                    pterr.write(`${entry.title}: ${entry.message}\n`);
                    break;
                default:
                    ptout.write(`${entry.title}: ${entry.message}\n`);
                    break;
            }
        });

        const disconnect = () => {
            connected = false;
            this.peer.kill('plugin disconnected');
        };

        this.worker.on('exit', async (code, signal) => {
            logger.log('e', `${this.pluginName} exited ${code} ${signal}`);
            disconnect();
        });
        this.worker.on('error', e => {
            logger.log('e', `${this.pluginName} error ${e}`);
            disconnect();
        });

        return peer;
    }

    async createRpcIoPeer(socket: IOServerSocket, accessControls: AccessControls) {
        const serializer = createRpcSerializer({
            sendMessageBuffer: buffer => socket.send(buffer),
            sendMessageFinish: message => socket.send(JSON.stringify(message)),
        });

        socket.on('message', data => {
            if (data.constructor === Buffer || data.constructor === ArrayBuffer) {
                serializer.onMessageBuffer(Buffer.from(data));
            }
            else {
                serializer.onMessageFinish(JSON.parse(data as string));
            }
        });

        const rpcPeer = new RpcPeer(`api/${this.pluginId}`, 'engine.io', (message, reject, serializationContext) => {
            try {
                serializer.sendMessage(message, reject, serializationContext);
            }
            catch (e) {
                reject?.(e);
            }
        });
        rpcPeer.tags.acl = accessControls;
        serializer.setupRpcPeer(rpcPeer);

        // wrap the host api with a connection specific api that can be torn down on disconnect
        const createMediaManager = await this.peer.getParam('createMediaManager');
        const api = new PluginAPIProxy(this.api, await createMediaManager());
        api.acl = accessControls;
        const kill = () => {
            serializer.onDisconnected();
            api.removeListeners();
        }
        socket.on('close', kill);
        socket.on('error', kill);

        return setupPluginRemote(rpcPeer, api, null, { serverVersion }, () => this.scrypted.stateManager.getSystemState());
    }
}
