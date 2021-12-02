import { RpcMessage, RpcPeer } from '../rpc';
import AdmZip from 'adm-zip';
import { SystemManager, DeviceManager, ScryptedNativeId, Device, EventListenerRegister, EngineIOHandler, ScryptedInterfaceProperty, SystemDeviceState } from '@scrypted/sdk/types'
import { ScryptedRuntime } from '../runtime';
import { Plugin } from '../db-types';
import io from 'engine.io';
import { attachPluginRemote, setupPluginRemote } from './plugin-remote';
import { PluginRemote, PluginRemoteLoadZipOptions } from './plugin-api';
import { Logger } from '../logger';
import { MediaManagerHostImpl, MediaManagerImpl } from './media';
import { getState } from '../state';
import WebSocket, { EventEmitter } from 'ws';
import { listenZero } from './listen-zero';
import { Server } from 'net';
import repl from 'repl';
import { once } from 'events';
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

        for (const device of Object.values(this.scrypted.devices)) {
            const pluginDevice = this.scrypted.pluginDevices[device.handler.id];
            if (!pluginDevice) {
                console.warn('PluginDevice missing?', device.handler.id);
                continue;
            }
            for (const mixin of getState(pluginDevice, ScryptedInterfaceProperty.mixins) || []) {
                if (this.scrypted.findPluginDeviceById(mixin)?.pluginId === this.pluginId) {
                    device.handler.invalidate();
                }
            }
        }
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

        this.startPluginClusterHost(logger, {
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
                handler.onConnection(endpointRequest, `io://${socket.id}`);

                socket.on('message', message => {
                    this.remote.ioEvent(socket.id, 'message', message)
                });
                socket.on('close', reason => {
                    this.remote.ioEvent(socket.id, 'close');
                });
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

    startPluginClusterHost(logger: Logger, env?: any, runtime?: string) {
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

            this.worker = child_process.spawn('python', args, {
                // stdin, stdout, stderr, peer in, peer out
                stdio: ['pipe', 'inherit', 'inherit', 'pipe', 'pipe'],
                env: Object.assign({}, process.env, env),
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
                stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
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

        // this.worker.stdout.on('data', data => console.log(data.toString()));
        // this.worker.stderr.on('data', data => console.error(data.toString()));

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

async function createConsoleServer(events: EventEmitter): Promise<number[]> {
    const outputs = new Map<string, Buffer[]>();
    const appendOutput = (data: Buffer, nativeId: ScryptedNativeId) => {
        if (!nativeId)
            nativeId = undefined;
        let buffers = outputs.get(nativeId);
        if (!buffers) {
            buffers = [];
            outputs.set(nativeId, buffers);
        }
        buffers.push(data);
        // when we're over 4000 lines or whatever these buffer are,
        // truncate down to 2000.
        if (buffers.length > 4000)
            outputs.set(nativeId, buffers.slice(buffers.length - 2000))
    };
    events.on('stdout', appendOutput);
    events.on('stderr', appendOutput);

    const server = new Server(async (socket) => {
        let [filter] = await once(socket, 'data');
        filter = filter.toString().trim();
        if (filter === 'undefined')
            filter = undefined;

        const buffers = outputs.get(filter);
        if (buffers) {
            const concat = Buffer.concat(buffers);
            outputs.set(filter, [concat]);
            socket.write(concat);
        }

        const cb = (data: Buffer, nativeId: ScryptedNativeId) => {
            if (nativeId !== filter)
                return;
            socket.write(data);
        };
        events.on('stdout', cb)
        events.on('stderr', cb)

        const cleanup = () => {
            events.removeListener('stdout', cb);
            events.removeListener('stderr', cb);
        };

        socket.on('close', cleanup);
        socket.on('error', cleanup);
        socket.on('end', cleanup);
    });


    const writeServer = new Server(async (socket) => {
        const [data] = await once(socket, 'data');
        let filter: string = data.toString();
        const newline = filter.indexOf('\n');
        if (newline !== -1) {
            socket.unshift(Buffer.from(filter.substring(newline + 1)));
        }
        filter = filter.substring(0, newline);

        if (filter === 'undefined')
            filter = undefined;

        const cb = (data: Buffer) => events.emit('stdout', data, filter);

        socket.on('data', cb);

        const cleanup = () => {
            events.removeListener('data', cb);
        };

        socket.on('close', cleanup);
        socket.on('error', cleanup);
        socket.on('end', cleanup);
    });
    const consoleReader = await listenZero(server);
    const consoleWriter = await listenZero(writeServer);

    return [consoleReader, consoleWriter];
}

async function createREPLServer(events: EventEmitter): Promise<number> {
    const [[scrypted], [params], [plugin]] = await Promise.all([once(events, 'scrypted'), once(events, 'params'), once(events, 'plugin')]);
    const { deviceManager, systemManager } = scrypted;
    const server = new Server(async (socket) => {
        let [filter] = await once(socket, 'data');
        filter = filter.toString().trim();
        if (filter === 'undefined')
            filter = undefined;

        const chain: string[] = [];
        const nativeIds: Map<string, any> = deviceManager.nativeIds;
        const reversed = new Map<string, string>();
        for (const nativeId of nativeIds.keys()) {
            reversed.set(nativeIds.get(nativeId).id, nativeId);
        }

        while (filter) {
            const { id } = nativeIds.get(filter);
            const d = await systemManager.getDeviceById(id);
            chain.push(filter);
            filter = reversed.get(d.providerId);
        }

        chain.reverse();
        let device = plugin;
        for (const c of chain) {
            device = await device.getDevice(c);
        }


        const ctx = Object.assign(params, {
            device
        });
        delete ctx.console;
        delete ctx.window;
        delete ctx.WebSocket;
        delete ctx.pluginHostAPI;

        const replFilter = new Set<string>(['require', 'localStorage'])
        const replVariables = Object.keys(ctx).filter(key => !replFilter.has(key));

        const welcome = `JavaScript REPL variables:\n${replVariables.map(key => '  ' + key).join('\n')}\n\n`;
        socket.write(welcome);

        const r = repl.start({
            terminal: true,
            input: socket,
            output: socket,
            // writer(this: REPLServer, obj: any) {
            //     const ret = util.inspect(obj, {
            //         colors: true,
            //     });
            //     return ret;//.replaceAll('\n', '\r\n');
            // },
            preview: false,
        });

        Object.assign(r.context, ctx);

        const cleanup = () => {
            r.close();
        };

        socket.on('close', cleanup);
        socket.on('error', cleanup);
        socket.on('end', cleanup);
    });
    return listenZero(server);
}

export function startPluginClusterWorker() {
    const peer = new RpcPeer('unknown', 'host', (message, reject) => process.send(message, undefined, {
        swallowErrors: !reject,
    }, e => {
        if (e)
            reject?.(e);
    }));
    peer.transportSafeArgumentTypes.add(Buffer.name);
    process.on('message', message => peer.handleMessage(message as RpcMessage));

    const events = new EventEmitter();

    let systemManager: SystemManager;
    let deviceManager: DeviceManager;

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
        return getConsole(async (stdout, stderr) => {
            stdout.on('data', data => events.emit('stdout', data, nativeId));
            stderr.on('data', data => events.emit('stderr', data, nativeId));
        }, undefined, undefined);
    }

    const getMixinConsole = (mixinId: string, nativeId?: ScryptedNativeId) => {
        return getConsole(async (stdout, stderr) => {
            if (!mixinId || !systemManager.getDeviceById(mixinId).mixins.includes(idForNativeId(nativeId))) {
                stdout.on('data', data => events.emit('stdout', data, nativeId));
                stderr.on('data', data => events.emit('stderr', data, nativeId));
                return;
            }
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

    const consolePorts = createConsoleServer(events);
    const replPort = createREPLServer(events);

    const pluginConsole = getDeviceConsole(undefined);

    attachPluginRemote(peer, {
        createMediaManager: async (systemManager) => new MediaManagerImpl(systemManager, pluginConsole),
        events,
        getDeviceConsole,
        getMixinConsole,
        async getServicePort(name) {
            if (name === 'repl')
                return replPort;
            if (name === 'console')
                return (await consolePorts)[0];
            if (name === 'console-writer')
                return (await consolePorts)[1];
            throw new Error(`unknown service ${name}`);
        },
        async beforeLoadZip(zip: AdmZip, packageJson: any) {
            const pluginId = packageJson.name;
            peer.selfName = pluginId;
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
            const cp = await consolePorts;
            const writer = cp[1];
            const socket = net.connect(writer);
            await once(socket, 'connect');
            try {
                await installOptionalDependencies(pluginConsole, socket, packageJson);
            }
            finally {
                socket.destroy();
            }
        }
    }).then(scrypted => {
        systemManager = scrypted.systemManager;
        deviceManager = scrypted.deviceManager;

        events.emit('scrypted', scrypted);

        process.on('uncaughtException', e => {
            pluginConsole.error('uncaughtException', e);
            scrypted.log.e('uncaughtException ' + e?.toString());
        });
        process.on('unhandledRejection', e => {
            pluginConsole.error('unhandledRejection', e);
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
