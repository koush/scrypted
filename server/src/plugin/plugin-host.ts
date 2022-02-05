import { RpcPeer } from '../rpc';
import AdmZip from 'adm-zip';
import { Device, EngineIOHandler } from '@scrypted/types'
import { ScryptedRuntime } from '../runtime';
import { Plugin } from '../db-types';
import io, { Socket } from 'engine.io';
import { setupPluginRemote } from './plugin-remote';
import { PluginAPIProxy, PluginRemote, PluginRemoteLoadZipOptions } from './plugin-api';
import { Logger } from '../logger';
import { MediaManagerHostImpl } from './media';
import WebSocket from 'ws';
import { sleep } from '../sleep';
import { PluginHostAPI } from './plugin-host-api';
import path from 'path';
import child_process from 'child_process';
import { PluginDebug } from './plugin-debug';
import readline from 'readline';
import { Readable, Writable } from 'stream';
import { ensurePluginVolume, getScryptedVolume } from './plugin-volume';
import { getPluginNodePath } from './plugin-npm-dependencies';
import { ConsoleServer, createConsoleServer } from './plugin-console';
import { LazyRemote } from './plugin-lazy-remote';
import crypto from 'crypto';
import fs from 'fs';
import mkdirp from 'mkdirp';
import rimraf from 'rimraf';

export class PluginHost {
    static sharedWorker: child_process.ChildProcess;
    static sharedWorkerImmediateRestart = false;

    worker: child_process.ChildProcess;
    peer: RpcPeer;
    pluginId: string;
    module: Promise<any>;
    scrypted: ScryptedRuntime;
    remote: PluginRemote;
    io = io(undefined, {
        pingTimeout: 120000,
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
        // things might get a bit race prone, so clear out the shared worker before killing.
        if (this.worker === PluginHost.sharedWorker)
            PluginHost.sharedWorker = undefined;
        this.worker.kill('SIGKILL');
        this.io.close();
        for (const s of Object.values(this.ws)) {
            s.close();
        }
        this.ws = {};

        const deviceIds = new Set<string>(Object.values(this.scrypted.pluginDevices).filter(d => d.pluginId === this.pluginId).map(d => d._id));
        this.scrypted.invalidateMixins(deviceIds);

        this.consoleServer?.then(server => {
            server.readServer.close();
            server.writeServer.close();
            for (const s of server.sockets) {
                s.destroy();
            }
        });
        setTimeout(() => this.peer.kill('plugin killed'), 500);
    }

    toString() {
        return this.pluginName || 'no plugin name';
    }

    async upsertDevice(upsert: Device) {
        const pi = await this.scrypted.upsertDevice(this.pluginId, upsert, true);
        await this.remote.setNativeId(pi.nativeId, pi._id, pi.storage || {});
        return pi._id;
    }

    constructor(scrypted: ScryptedRuntime, plugin: Plugin, public pluginDebug?: PluginDebug) {
        this.scrypted = scrypted;
        this.pluginId = plugin._id;
        this.pluginName = plugin.packageJson?.name;
        this.packageJson = plugin.packageJson;
        let zipBuffer = Buffer.from(plugin.zip, 'base64');
        // allow garbage collection of the base 64 contents
        plugin = undefined;

        const logger = scrypted.getDeviceLogger(scrypted.findPluginDevice(this.pluginId));

        const volume = getScryptedVolume();
        const pluginVolume = ensurePluginVolume(this.pluginId);

        this.startPluginHost(logger, {
            NODE_PATH: path.join(getPluginNodePath(this.pluginId), 'node_modules'),
            SCRYPTED_PLUGIN_VOLUME: pluginVolume,
        }, this.packageJson.scrypted.runtime);

        this.io.on('connection', async (socket) => {
            try {
                try {
                    if (socket.request.url.indexOf('/api') !== -1) {
                        await this.createRpcIoPeer(socket);
                        return;
                    }
                }
                catch (e) {
                    socket.close();
                    return;
                }

                const {
                    endpointRequest,
                    pluginDevice,
                } = (socket.request as any).scrypted;

                const handler = this.scrypted.getDevice<EngineIOHandler>(pluginDevice._id);

                socket.on('message', message => {
                    this.remote.ioEvent(socket.id, 'message', message)
                });
                socket.on('close', reason => {
                    this.remote.ioEvent(socket.id, 'close');
                });

                await handler.onConnection(endpointRequest, `io://${socket.id}`);
            }
            catch (e) {
                console.error('engine.io plugin error', e);
                socket.close();
            }
        })

        const self = this;

        const { runtime } = this.packageJson.scrypted;
        const mediaManager = runtime === 'python'
            ? new MediaManagerHostImpl(scrypted.stateManager.getSystemState(), id => scrypted.getDevice(id), console)
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
                rimraf.sync(zipDirTmp);
                rimraf.sync(zipDir);
                mkdirp.sync(zipDirTmp);
                fs.writeFileSync(path.join(zipDirTmp, zipFilename), zipBuffer);
                const admZip = new AdmZip(zipBuffer);
                admZip.extractAllTo(path.join(zipDirTmp, 'unzipped'), true);
                fs.renameSync(zipDirTmp, zipDir);
            }
        }

        logger.log('i', `loading ${this.pluginName}`);
        logger.log('i', 'pid ' + this.worker?.pid);

        const remotePromise = setupPluginRemote(this.peer, this.api, self.pluginId, () => this.scrypted.stateManager.getSystemState());
        const init = (async () => {
            const remote = await remotePromise;

            for (const pluginDevice of scrypted.findPluginDevices(self.pluginId)) {
                await remote.setNativeId(pluginDevice.nativeId, pluginDevice._id, pluginDevice.storage || {});
            }

            await remote.setSystemState(scrypted.stateManager.getSystemState());
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

            const fail = 'Plugin failed to load. Console for more information.';
            try {
                const isPython = runtime === 'python';
                const loadZipOptions: PluginRemoteLoadZipOptions = {
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

    startPluginHost(logger: Logger, env?: any, runtime?: string) {
        let connected = true;

        if (runtime === 'python') {
            const args: string[] = [
                '-u',
            ];
            if (this.pluginDebug) {
                args.push(
                    '-m',
                    'debugpy',
                    '--listen',
                    `0.0.0.0:${this.pluginDebug.inspectPort}`,
                    '--wait-for-client',
                )
            }
            args.push(
                path.join(__dirname, '../../python', 'plugin-remote.py'),
            )

            this.worker = child_process.spawn('python3', args, {
                // stdin, stdout, stderr, peer in, peer out
                stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
                env: Object.assign({
                    PYTHONPATH: path.join(process.cwd(), 'node_modules/@scrypted/types'),
                }, process.env, env),
            });

            const peerin = this.worker.stdio[3] as Writable;
            const peerout = this.worker.stdio[4] as Readable;

            peerin.on('error', e => connected = false);
            peerout.on('error', e => connected = false);

            this.peer = new RpcPeer('host', this.pluginId, (message, reject) => {
                if (connected) {
                    peerin.write(JSON.stringify(message) + '\n', e => e && reject?.(e));
                }
                else if (reject) {
                    reject(new Error('peer disconnected'));
                }
            });

            const readInterface = readline.createInterface({
                input: peerout,
                terminal: false,
            });
            readInterface.on('line', line => {
                this.peer.handleMessage(JSON.parse(line));
            });
        }
        else {
            const execArgv: string[] = process.execArgv.slice();
            if (this.pluginDebug) {
                execArgv.push(`--inspect=0.0.0.0:${this.pluginDebug.inspectPort}`);
            }

            const useSharedWorker = process.env.SCRYPTED_SHARED_WORKER &&
                this.packageJson.scrypted.sharedWorker !== false &&
                this.packageJson.scrypted.realfs !== true &&
                Object.keys(this.packageJson.optionalDependencies || {}).length === 0;
            if (useSharedWorker) {
                if (!PluginHost.sharedWorker) {
                    const worker = child_process.fork(require.main.filename, ['child', '@scrypted/shared'], {
                        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
                        env: Object.assign({}, process.env, env),
                        serialization: 'advanced',
                        execArgv,
                    });
                    PluginHost.sharedWorker = worker;
                    PluginHost.sharedWorker.setMaxListeners(100);
                    const clearSharedWorker = () => {
                        if (worker === PluginHost.sharedWorker)
                            PluginHost.sharedWorker = undefined;
                    };
                    PluginHost.sharedWorker.on('close', () => clearSharedWorker);
                    PluginHost.sharedWorker.on('error', () => clearSharedWorker);
                    PluginHost.sharedWorker.on('exit', () => clearSharedWorker);
                    PluginHost.sharedWorker.on('disconnect', () => clearSharedWorker);
                }
                PluginHost.sharedWorker.send({
                    type: 'start',
                    pluginId: this.pluginId,
                });
                this.worker = PluginHost.sharedWorker;
                this.worker.on('message', (message: any) => {
                    if (message.pluginId === this.pluginId)
                        this.peer.handleMessage(message.message)
                });
    
                this.peer = new RpcPeer('host', this.pluginId, (message, reject) => {
                    if (connected) {
                        this.worker.send({
                            type: 'message',
                            pluginId: this.pluginId,
                            message: message,
                        }, undefined, e => {
                            if (e && reject)
                                reject(e);
                        });
                    }
                    else if (reject) {
                        reject(new Error('peer disconnected'));
                    }
                });
            }
            else {
                this.worker = child_process.fork(require.main.filename, ['child', this.pluginId], {
                    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
                    env: Object.assign({}, process.env, env),
                    serialization: 'advanced',
                    execArgv,
                });
                this.worker.on('message', message => this.peer.handleMessage(message as any));
    
                this.peer = new RpcPeer('host', this.pluginId, (message, reject) => {
                    if (connected) {
                        this.worker.send(message, undefined, e => {
                            if (e && reject)
                                reject(e);
                        });
                    }
                    else if (reject) {
                        reject(new Error('peer disconnected'));
                    }
                });
            }

            this.peer.transportSafeArgumentTypes.add(Buffer.name);
        }

        this.worker.stdout.on('data', data => console.log(data.toString()));
        this.worker.stderr.on('data', data => console.error(data.toString()));
        this.consoleServer = createConsoleServer(this.worker.stdout, this.worker.stderr);

        this.consoleServer.then(cs => {
            const { pluginConsole } = cs;
            pluginConsole.log('starting plugin', this.pluginId, this.packageJson.version);
        });

        this.worker.on('close', () => {
            connected = false;
            logger.log('e', `${this.pluginName} close`);
        });
        this.worker.on('disconnect', () => {
            connected = false;
            logger.log('e', `${this.pluginName} disconnected`);
        });
        this.worker.on('exit', async (code, signal) => {
            connected = false;
            logger.log('e', `${this.pluginName} exited ${code} ${signal}`);
        });
        this.worker.on('error', e => {
            connected = false;
            logger.log('e', `${this.pluginName} error ${e}`);
        });

        this.peer.onOob = (oob: any) => {
            if (oob.type === 'stats') {
                this.stats = oob;
            }
        };
    }

    async createRpcIoPeer(socket: Socket) {
        let connected = true;
        const rpcPeer = new RpcPeer(`api/${this.pluginId}`, 'web', (message, reject) => {
            if (!connected)
                reject?.(new Error('peer disconnected'));
            else
                socket.send(JSON.stringify(message))
        });
        socket.on('message', data => rpcPeer.handleMessage(JSON.parse(data as string)));
        // wrap the host api with a connection specific api that can be torn down on disconnect
        const api = new PluginAPIProxy(this.api, await this.peer.getParam('mediaManager'));
        const kill = () => {
            connected = false;
            rpcPeer.kill('engine.io connection closed.')
            api.removeListeners();
        }
        socket.on('close', kill);
        socket.on('error', kill);
        return setupPluginRemote(rpcPeer, api, null, () => this.scrypted.stateManager.getSystemState());
    }
}
