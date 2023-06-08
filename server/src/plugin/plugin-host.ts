import { Device, EngineIOHandler } from '@scrypted/types';
import AdmZip from 'adm-zip';
import crypto from 'crypto';
import * as io from 'engine.io';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { Duplex } from 'stream';
import WebSocket from 'ws';
import { Plugin } from '../db-types';
import { IOServer, IOServerSocket } from '../io';
import { Logger } from '../logger';
import { RpcPeer } from '../rpc';
import { createDuplexRpcPeer, createRpcSerializer } from '../rpc-serializer';
import { ScryptedRuntime } from '../runtime';
import { sleep } from '../sleep';
import { AccessControls } from './acl';
import { MediaManagerHostImpl } from './media';
import { PluginAPIProxy, PluginRemote, PluginRemoteLoadZipOptions } from './plugin-api';
import { ConsoleServer, createConsoleServer } from './plugin-console';
import { PluginDebug } from './plugin-debug';
import { PluginHostAPI } from './plugin-host-api';
import { LazyRemote } from './plugin-lazy-remote';
import { setupPluginRemote } from './plugin-remote';
import { WebSocketConnection } from './plugin-remote-websocket';
import { ensurePluginVolume, getScryptedVolume } from './plugin-volume';
import { RuntimeWorker } from './runtime/runtime-worker';

const serverVersion = require('../../package.json').version;

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
    stats: {
        cpuUsage: NodeJS.CpuUsage,
        memoryUsage: NodeJS.MemoryUsage,
    };
    killed = false;
    consoleServer: Promise<ConsoleServer>;
    unzippedPath: string;

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

        const deviceIds = new Set<string>(Object.values(this.scrypted.pluginDevices).filter(d => d.pluginId === this.pluginId).map(d => d._id));
        this.scrypted.invalidateMixins(deviceIds);

        this.consoleServer.then(server => server.destroy());
    }

    toString() {
        return this.pluginName || 'no plugin name';
    }

    async upsertDevice(upsert: Device) {
        const { pluginDevicePromise, interfacesChanged } = this.scrypted.upsertDevice(this.pluginId, upsert);
        const pi = await pluginDevicePromise;
        await this.remote.setNativeId(pi.nativeId, pi._id, pi.storage || {});
        // fetch a new device instance if the descriptor changed.
        // plugin may return the same instance.
        // this avoids device and mixin churn.
        // do this on next tick, after this call has returned an id, so the plugin can handle
        // any subsequent requests.
        process.nextTick(async () => {
            let needInvalidate = interfacesChanged;
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
        let zipBuffer = Buffer.from(plugin.zip, 'base64');
        // allow garbage collection of the base 64 contents
        plugin = undefined;

        const pluginDeviceId = scrypted.findPluginDevice(this.pluginId)._id;
        const logger = scrypted.getDeviceLogger(scrypted.findPluginDevice(this.pluginId));

        const volume = getScryptedVolume();
        const pluginVolume = ensurePluginVolume(this.pluginId);

        this.startPluginHost(logger, {
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

        const self = this;

        const { runtime } = this.packageJson.scrypted;
        const mediaManager = runtime === 'python'
            ? new MediaManagerHostImpl(pluginDeviceId, () => scrypted.stateManager.getSystemState(), console, id => scrypted.getDevice(id))
            : undefined;

        this.api = new PluginHostAPI(scrypted, this.pluginId, this, mediaManager);

        const zipDir = path.join(pluginVolume, 'zip');
        const extractVersion = "1-";
        const hash = extractVersion + crypto.createHash('md5').update(zipBuffer).digest().toString('hex');
        const zipFilename = `${hash}.zip`;
        const zipFile = path.join(zipDir, zipFilename);
        this.unzippedPath = path.join(zipDir, 'unzipped')
        {
            const zipDirTmp = zipDir + '.tmp';
            if (!fs.existsSync(zipFile)) {
                fs.rmSync(zipDirTmp, {
                    recursive: true,
                    force: true,
                });
                fs.rmSync(zipDir, {
                    recursive: true,
                    force: true,
                });
                fs.mkdirSync(zipDirTmp, {
                    recursive: true,
                });
                fs.writeFileSync(path.join(zipDirTmp, zipFilename), zipBuffer);
                const admZip = new AdmZip(zipBuffer);
                admZip.extractAllTo(path.join(zipDirTmp, 'unzipped'), true);
                fs.renameSync(zipDirTmp, zipDir);
            }
        }

        logger.log('i', `loading ${this.pluginName}`);
        logger.log('i', 'pid ' + this.worker?.pid);

        const remotePromise = setupPluginRemote(this.peer, this.api, self.pluginId, { serverVersion }, () => this.scrypted.stateManager.getSystemState());
        const init = (async () => {
            const remote = await remotePromise;

            for (const pluginDevice of scrypted.findPluginDevices(self.pluginId)) {
                await remote.setNativeId(pluginDevice.nativeId, pluginDevice._id, pluginDevice.storage || {});
            }

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
                const isPython = runtime === 'python';
                const loadZipOptions: PluginRemoteLoadZipOptions = {
                    clusterId: scrypted.clusterId,
                    clusterSecret: scrypted.clusterSecret,
                    // if debugging, use a normalized path for sourcemap resolution, otherwise
                    // prefix with module path.
                    filename: isPython
                        ? pluginDebug
                            ? `${volume}/plugin.zip`
                            : zipFile
                        : pluginDebug
                            ? '/plugin/main.nodejs.js'
                            : `/${this.pluginId}/main.nodejs.js`,
                    unzippedPath: this.unzippedPath,
                };
                // original implementation sent the zipBuffer, sending the zipFile name now.
                // can switch back for non-local plugins.
                const modulePromise = remote.loadZip(this.packageJson, zipFile, loadZipOptions);
                // allow garbage collection of the zip buffer
                zipBuffer = undefined;
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
        })();

        this.module = init.then(({ module }) => module);
        this.remote = new LazyRemote(remotePromise, init.then(({ remote }) => remote));

        init.catch(e => {
            console.error('plugin failed to load', e);
            this.api.removeListeners();
        });
    }

    startPluginHost(logger: Logger, env: any, pluginDebug: PluginDebug) {
        let connected = true;

        let { runtime } = this.packageJson.scrypted;
        runtime ||= 'node';

        const workerHost = this.scrypted.pluginHosts.get(runtime);
        if (!workerHost)
            throw new Error(`Unsupported Scrypted runtime: ${this.packageJson.scrypted.runtime}`);

        this.worker = workerHost(this.scrypted.mainFilename, this.pluginId, {
            packageJson: this.packageJson,
            env,
            pluginDebug,
        });

        this.peer = new RpcPeer('host', this.pluginId, (message, reject, serializationContext) => {
            if (connected) {
                this.worker.send(message, reject, serializationContext);
            }
            else if (reject) {
                reject(new Error('peer disconnected'));
            }
        });

        this.worker.setupRpcPeer(this.peer);

        this.worker.stdout.on('data', data => console.log(data.toString()));
        this.worker.stderr.on('data', data => console.error(data.toString()));
        let consoleHeader = `${os.platform()} ${os.arch()} ${os.version()}\nserver version: ${serverVersion}\nplugin version: ${this.pluginId} ${this.packageJson.version}\n`;
        if (process.env.SCRYPTED_DOCKER_FLAVOR)
            consoleHeader += `${process.env.SCRYPTED_DOCKER_FLAVOR}\n`;
        this.consoleServer = createConsoleServer(this.worker.stdout, this.worker.stderr, consoleHeader);

        const disconnect = () => {
            connected = false;
            this.peer.kill('plugin disconnected');
        };

        this.worker.on('close', () => {
            logger.log('e', `${this.pluginName} close`);
            disconnect();
        });
        this.worker.on('disconnect', () => {
            logger.log('e', `${this.pluginName} disconnected`);
            disconnect();
        });
        this.worker.on('exit', async (code, signal) => {
            logger.log('e', `${this.pluginName} exited ${code} ${signal}`);
            disconnect();
        });
        this.worker.on('error', e => {
            logger.log('e', `${this.pluginName} error ${e}`);
            disconnect();
        });

        this.worker.on('rpc', async (message, sendHandle) => {
            const socket = sendHandle as net.Socket;
            const { pluginId, username } = message;
            const host = this.scrypted.plugins[pluginId];
            if (!host) {
                socket.destroy();
                return;
            }
            try {
                const accessControls = await this.scrypted.getAccessControls(username)
                host.createRpcPeer(socket, accessControls);
            }
            catch (e) {
                socket.destroy();
                return;
            }
        });

        const startupTime = Date.now();
        // the plugin is expected to send process stats every 10 seconds.
        // this can be used as a check for liveness.
        let lastStats: number;
        const statsInterval = setInterval(async () => {
            const now = Date.now();
            // plugin may take a while to install, so wait 10 minutes.
            // after that, require 1 minute checkins.
            if (!lastStats) {
                if (now - startupTime > 10 * 60 * 1000) {
                    const logger = await this.api.getLogger(undefined);
                    logger.log('e', 'plugin failed to start in a timely manner. restarting.');
                    this.api.requestRestart();
                }
                return;
            }
            if (!pluginDebug && (lastStats + 60000 < now)) {
                const logger = await this.api.getLogger(undefined);
                logger.log('e', 'plugin is unresponsive. restarting.');
                this.api.requestRestart();
            }
        }, 60000);
        this.peer.killed.finally(() => clearInterval(statsInterval));
        this.peer.params.updateStats = (stats: any) => {
            lastStats = Date.now();
            this.stats = stats;
        }
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

    async createRpcPeer(duplex: Duplex, accessControls: AccessControls) {
        const rpcPeer = createDuplexRpcPeer(`api/${this.pluginId}`, 'duplex', duplex, duplex);
        rpcPeer.tags.acl = accessControls;

        // wrap the host api with a connection specific api that can be torn down on disconnect
        const createMediaManager = await this.peer.getParam('createMediaManager');
        const api = new PluginAPIProxy(this.api, await createMediaManager());
        const kill = () => {
            api.removeListeners();
        };
        duplex.on('close', kill);

        return setupPluginRemote(rpcPeer, api, null, { serverVersion }, () => this.scrypted.stateManager.getSystemState());
    }
}
