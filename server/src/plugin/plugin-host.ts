import { RpcMessage, RpcPeer } from '../rpc';
import AdmZip from 'adm-zip';
import { SystemManager, DeviceManager, ScryptedNativeId, Device, EventListenerRegister, EngineIOHandler, ScryptedInterfaceProperty, SystemDeviceState } from '@scrypted/sdk/types'
import { ScryptedRuntime } from '../runtime';
import { Plugin } from '../db-types';
import io from 'engine.io';
import { attachPluginRemote, setupPluginRemote } from './plugin-remote';
import { PluginAPI, PluginRemote, PluginRemoteLoadZipOptions } from './plugin-api';
import { Logger } from '../logger';
import { MediaManagerHostImpl, MediaManagerImpl } from './media';
import { getState } from '../state';
import WebSocket, { EventEmitter } from 'ws';
import { PassThrough } from 'stream';
import { Console } from 'console'
import { sleep } from '../sleep';
import { PluginHostAPI } from './plugin-host-api';
import path from 'path';
import { install as installSourceMapSupport } from 'source-map-support';
import net from 'net'
import child_process from 'child_process';
import { PluginDebug } from './plugin-debug';
import readline from 'readline';
import { Readable, Writable } from 'stream';
import { ensurePluginVolume } from './plugin-volume';
import { installOptionalDependencies } from './plugin-npm-dependencies';
import { ConsoleServer, createConsoleServer } from './plugin-console';
import { createREPLServer } from './plugin-repl';

export class PluginHost {
    worker: child_process.ChildProcess;
    peer: RpcPeer;
    pluginId: string;
    module: Promise<any>;
    scrypted: ScryptedRuntime;
    remote: PluginRemote;
    zip: AdmZip;
    io = io(undefined, {
        pingTimeout: 120000,
    });
    ws: { [id: string]: WebSocket } = {};
    api: PluginHostAPI;
    pluginName: string;
    packageJson: any;
    listener: EventListenerRegister;
    stats: {
        cpuUsage: NodeJS.CpuUsage,
        memoryUsage: NodeJS.MemoryUsage,
    };
    killed = false;
    consoleServer: Promise<ConsoleServer>;

    kill() {
        this.killed = true;
        this.listener.removeListener();
        this.api.removeListeners();
        this.worker.kill();
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
        const logger = scrypted.getDeviceLogger(scrypted.findPluginDevice(plugin._id));

        const volume = path.join(process.cwd(), 'volume');
        const cwd = ensurePluginVolume(this.pluginId);

        this.startPluginHost(logger, {
            NODE_PATH: path.join(cwd, 'node_modules'),
            SCRYPTED_PLUGIN_VOLUME: cwd,
        }, plugin.packageJson.scrypted.runtime);

        this.io.on('connection', async (socket) => {
            try {
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

        this.api = new PluginHostAPI(scrypted, plugin, this, mediaManager);

        const zipBuffer = Buffer.from(plugin.zip, 'base64');
        this.zip = new AdmZip(zipBuffer);

        logger.log('i', `loading ${this.pluginName}`);
        logger.log('i', 'pid ' + this.worker?.pid);


        const remotePromise = setupPluginRemote(this.peer, this.api, self.pluginId);
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
                const loadZipOptions: PluginRemoteLoadZipOptions = {
                    // if debugging, use a normalized path for sourcemap resolution, otherwise
                    // prefix with module path.
                    filename: runtime === 'python'
                        ? pluginDebug
                            ? `${volume}/plugin.zip`
                            : `${cwd}/plugin.zip`
                        : pluginDebug
                            ? '/plugin/main.nodejs.js'
                            : `/${this.pluginId}/main.nodejs.js`,
                };
                const module = await remote.loadZip(plugin.packageJson, zipBuffer, loadZipOptions);
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

        this.listener = scrypted.stateManager.listen((id, eventDetails, eventData) => {
            if (eventDetails.property) {
                const device = scrypted.findPluginDeviceById(id);
                this.remote.notify(id, eventDetails.eventTime, eventDetails.eventInterface, eventDetails.property, device?.state[eventDetails.property], eventDetails.changed);
            }
            else {
                this.remote.notify(id, eventDetails.eventTime, eventDetails.eventInterface, eventDetails.property, eventData, eventDetails.changed);
            }
        });

        init.catch(e => {
            console.error('plugin failed to load', e);
            this.listener.removeListener();
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
                    PYTHONPATH: path.join(process.cwd(), 'node_modules/@scrypted/sdk'),
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

            this.worker = child_process.fork(require.main.filename, ['child'], {
                stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
                env: Object.assign({}, process.env, env),
                serialization: 'advanced',
                execArgv,
            });

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
            this.peer.transportSafeArgumentTypes.add(Buffer.name);

            this.worker.on('message', message => this.peer.handleMessage(message as any));
        }

        this.worker.stdout.on('data', data => console.log(data.toString()));
        this.worker.stderr.on('data', data => console.error(data.toString()));
        this.consoleServer = createConsoleServer(this.worker.stdout, this.worker.stderr);

        this.consoleServer.then(cs => {
            const { pluginConsole } = cs;
            pluginConsole.log('starting plugin', this.pluginId, this.packageJson.version);
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
}

export function startPluginRemote() {
    const peer = new RpcPeer('unknown', 'host', (message, reject) => process.send(message, undefined, {
        swallowErrors: !reject,
    }, e => {
        if (e)
            reject?.(e);
    }));
    peer.transportSafeArgumentTypes.add(Buffer.name);
    process.on('message', message => peer.handleMessage(message as RpcMessage));

    let systemManager: SystemManager;
    let deviceManager: DeviceManager;
    let api: PluginAPI;
    let pluginId: string;

    function idForNativeId(nativeId: ScryptedNativeId) {
        if (!deviceManager)
            return;
        const ds = deviceManager.getDeviceState(nativeId);
        return ds?.id;
    }

    const getConsole = (hook: (stdout: PassThrough, stderr: PassThrough) => Promise<void>,
        also?: Console, alsoPrefix?: string) => {

        const stdout = new PassThrough();
        const stderr = new PassThrough();

        hook(stdout, stderr);

        const ret = new Console(stdout, stderr);

        const methods = [
            'log', 'warn',
            'dir', 'time',
            'timeEnd', 'timeLog',
            'trace', 'assert',
            'clear', 'count',
            'countReset', 'group',
            'groupEnd', 'table',
            'debug', 'info',
            'dirxml', 'error',
            'groupCollapsed',
        ];

        const printers = ['log', 'info', 'debug', 'trace', 'warn', 'error'];
        for (const m of methods) {
            const old = (ret as any)[m].bind(ret);
            (ret as any)[m] = (...args: any[]) => {
                // prefer the mixin version for local/remote console dump.
                if (also && alsoPrefix && printers.includes(m)) {
                    (also as any)[m](alsoPrefix, ...args);
                }
                else {
                    (console as any)[m](...args);
                }
                // call through to old method to ensure it gets written
                // to log buffer.
                old(...args);
            }
        }

        return ret;
    }

    const getDeviceConsole = (nativeId?: ScryptedNativeId) => {
        // the the plugin console is simply the default console
        // and gets read from stderr/stdout.
        if (!nativeId)
            return console;

        return getConsole(async (stdout, stderr) => {
            const plugins = await api.getComponent('plugins');
            const connect = async () => {
                const port = await plugins.getRemoteServicePort(peer.selfName, 'console-writer');
                const socket = net.connect(port);
                socket.write(nativeId + '\n');
                const writer = (data: Buffer) => {
                    socket.write(data);
                };
                stdout.on('data', writer);
                stderr.on('data', writer);
                socket.on('error', () => {
                    stdout.removeAllListeners();
                    stderr.removeAllListeners();
                    stdout.pause();
                    stderr.pause();
                    setTimeout(connect, 10000);
                });
            };
            connect();
        }, undefined, undefined);
    }

    const getMixinConsole = (mixinId: string, nativeId: ScryptedNativeId) => {
        return getConsole(async (stdout, stderr) => {
            if (!mixinId) {
                return;
            }
            // todo: fix this. a mixin provider can mixin another device to make it a mixin provider itself.
            // so the mixin id in the mixin table will be incorrect.
            // there's no easy way to fix this from the remote.
            // if (!systemManager.getDeviceById(mixinId).mixins.includes(idForNativeId(nativeId))) {
            //     return;
            // }
            const plugins = await systemManager.getComponent('plugins');
            const connect = async () => {
                const ds = deviceManager.getDeviceState(nativeId);
                if (!ds) {
                    // deleted?
                    return;
                }
                const { pluginId, nativeId: mixinNativeId } = await plugins.getDeviceInfo(mixinId);
                const port = await plugins.getRemoteServicePort(pluginId, 'console-writer');
                const socket = net.connect(port);
                socket.write(mixinNativeId + '\n');
                const writer = (data: Buffer) => {
                    let str = data.toString().trim();
                    str = str.replaceAll('\n', `\n[${ds.name}]: `);
                    str = `[${ds.name}]: ` + str + '\n';
                    socket.write(str);
                };
                stdout.on('data', writer);
                stderr.on('data', writer);
                socket.on('error', () => {
                    stdout.removeAllListeners();
                    stderr.removeAllListeners();
                    stdout.pause();
                    stderr.pause();
                    setTimeout(connect, 10000);
                });
            };
            connect();
        }, getDeviceConsole(nativeId), `[${systemManager.getDeviceById(mixinId)?.name}]`);
    }

    let lastCpuUsage: NodeJS.CpuUsage;
    setInterval(() => {
        const cpuUsage = process.cpuUsage(lastCpuUsage);
        lastCpuUsage = cpuUsage;
        peer.sendOob({
            type: 'stats',
            cpu: cpuUsage,
            memoryUsage: process.memoryUsage(),
        });
        global?.gc();
    }, 10000);

    let replPort: Promise<number>;

    let _pluginConsole: Console;
    const getPluginConsole = () => {
        if (!_pluginConsole)
            _pluginConsole = getDeviceConsole(undefined);
        return _pluginConsole;
    }

    attachPluginRemote(peer, {
        createMediaManager: async (sm) => {
            systemManager = sm;
            return new MediaManagerImpl(systemManager, getPluginConsole());
        },
        onGetRemote: async (_api, _pluginId) => {
            api = _api;
            pluginId = _pluginId;
            peer.selfName = pluginId;
        },
        onPluginReady: async (scrypted, params, plugin) => {
            replPort = createREPLServer(scrypted, params, plugin);
        },
        getPluginConsole,
        getDeviceConsole,
        getMixinConsole,
        async getServicePort(name) {
            if (name === 'repl') {
                if (!replPort)
                    throw new Error('REPL unavailable: Plugin not loaded.')
                return replPort;
            }
            throw new Error(`unknown service ${name}`);
        },
        async onLoadZip(zip: AdmZip, packageJson: any) {
            installSourceMapSupport({
                environment: 'node',
                retrieveSourceMap(source) {
                    if (source === '/plugin/main.nodejs.js' || source === `/${pluginId}/main.nodejs.js`) {
                        const entry = zip.getEntry('main.nodejs.js.map')
                        const map = entry?.getData().toString();
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
            await installOptionalDependencies(getPluginConsole(), packageJson);
        }
    }).then(scrypted => {
        systemManager = scrypted.systemManager;
        deviceManager = scrypted.deviceManager;

        process.on('uncaughtException', e => {
            getPluginConsole().error('uncaughtException', e);
            scrypted.log.e('uncaughtException ' + e?.toString());
        });
        process.on('unhandledRejection', e => {
            getPluginConsole().error('unhandledRejection', e);
            scrypted.log.e('unhandledRejection ' + e?.toString());
        });
    })
}

/**
 * Warning: do not await in any of these methods unless necessary, otherwise
 * execution order of state reporting may fail.
 */
class LazyRemote implements PluginRemote {
    remote: PluginRemote;

    constructor(public remotePromise: Promise<PluginRemote>, public remoteReadyPromise: Promise<PluginRemote>) {
        this.remoteReadyPromise = (async () => {
            this.remote = await remoteReadyPromise;
            return this.remote;
        })();
    }

    async loadZip(packageJson: any, zipData: Buffer, options?: PluginRemoteLoadZipOptions): Promise<any> {
        if (!this.remote)
            await this.remoteReadyPromise;
        return this.remote.loadZip(packageJson, zipData, options);
    }
    async setSystemState(state: { [id: string]: { [property: string]: SystemDeviceState; }; }): Promise<void> {
        if (!this.remote)
            await this.remoteReadyPromise;
        return this.remote.setSystemState(state);
    }
    async setNativeId(nativeId: ScryptedNativeId, id: string, storage: { [key: string]: any; }): Promise<void> {
        if (!this.remote)
            await this.remoteReadyPromise;
        return this.remote.setNativeId(nativeId, id, storage);
    }
    async updateDeviceState(id: string, state: { [property: string]: SystemDeviceState; }): Promise<void> {
        try {
            if (!this.remote)
                await this.remoteReadyPromise;
        }
        catch (e) {
            return;
        }
        return this.remote.updateDeviceState(id, state);
    }
    async notify(id: string, eventTime: number, eventInterface: string, property: string, propertyState: SystemDeviceState, changed?: boolean): Promise<void> {
        try {
            if (!this.remote)
                await this.remoteReadyPromise;
        }
        catch (e) {
            return;
        }
        return this.remote.notify(id, eventTime, eventInterface, property, propertyState, changed);
    }
    async ioEvent(id: string, event: string, message?: any): Promise<void> {
        if (!this.remote)
            await this.remoteReadyPromise;
        return this.remote.ioEvent(id, event, message);
    }
    async createDeviceState(id: string, setState: (property: string, value: any) => Promise<void>): Promise<any> {
        if (!this.remote)
            await this.remoteReadyPromise;
        return this.remote.createDeviceState(id, setState);
    }

    async getServicePort(name: string): Promise<number> {
        const remote = await this.remotePromise;
        return remote.getServicePort(name);
    }
}
