import cluster from 'cluster';
import { RpcMessage, RpcPeer } from '../rpc';
import AdmZip from 'adm-zip';
import { SystemManager, DeviceManager, ScryptedNativeId, Device, EventListenerRegister, EngineIOHandler, ScryptedInterfaceProperty, SystemDeviceState } from '@scrypted/sdk/types'
import { ScryptedRuntime } from '../runtime';
import { Plugin } from '../db-types';
import io from 'engine.io';
import { attachPluginRemote, setupPluginRemote } from './plugin-remote';
import { PluginRemote } from './plugin-api';
import { Logger } from '../logger';
import { MediaManagerImpl } from './media';
import { getState } from '../state';
import WebSocket, { EventEmitter } from 'ws';
import { listenZeroCluster } from './cluster-helper';
import { Server } from 'net';
import repl from 'repl';
import { once } from 'events';
import { PassThrough } from 'stream';
import { Console } from 'console'
import { sleep } from '../sleep';
import { PluginHostAPI } from './plugin-host-api';
import mkdirp from 'mkdirp';
import path from 'path';
import { install as installSourceMapSupport } from 'source-map-support';
import net from 'net'

export class PluginHost {
    worker: cluster.Worker;
    peer: RpcPeer;
    pluginId: string;
    module: Promise<any>;
    scrypted: ScryptedRuntime;
    console: Promise<Console>;
    remote: PluginRemote;
    zip: AdmZip;
    io = io(undefined, {
        pingTimeout: 120000,
    });
    ws: { [id: string]: WebSocket } = {};
    api: PluginHostAPI;
    pluginName: string;
    listener: EventListenerRegister;
    stats: {
        cpuUsage: NodeJS.CpuUsage,
        memoryUsage: NodeJS.MemoryUsage,
    };

    kill() {
        this.listener.removeListener();
        this.api.removeListeners();
        this.worker.process.kill();
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
    }

    constructor(scrypted: ScryptedRuntime, plugin: Plugin, waitDebug?: Promise<void>) {
        this.scrypted = scrypted;
        this.pluginId = plugin._id;
        this.pluginName = plugin.packageJson?.name;
        const logger = scrypted.getDeviceLogger(scrypted.findPluginDevice(plugin._id));

        if (true) {
            const cwd = path.join(process.cwd(), 'volume', 'plugins', this.pluginId);
            try {
                mkdirp.sync(cwd);
            }
            catch (e) {
            }

            this.startPluginClusterHost(logger, {
                SCRYPTED_PLUGIN_VOLUME: cwd,
            });
        }
        else {
            const remote = new RpcPeer((message, reject) => {
                try {
                    this.peer.handleMessage(message);
                }
                catch (e) {
                    if (reject && reject)
                        reject(e);
                }
            });

            this.peer = new RpcPeer((message, reject) => {
                try {
                    remote.handleMessage(message);
                }
                catch (e) {
                    if (reject)
                        reject(e);
                }
            });

            attachPluginRemote(remote, {
                createMediaManager: async (systemManager) => new MediaManagerImpl(systemManager, console),
            });
        }


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

        this.api = new PluginHostAPI(scrypted, plugin, this);

        this.console = this.peer.eval('return console', undefined, undefined, true) as Promise<Console>;
        const zipBuffer = Buffer.from(plugin.zip, 'base64');
        this.zip = new AdmZip(zipBuffer);

        logger.log('i', `loading ${this.pluginName}`);
        logger.log('i', 'pid ' + this.worker?.process.pid);

        const init = (async () => {
            const remote = await setupPluginRemote(this.peer, this.api, self.pluginId);

            for (const pluginDevice of scrypted.findPluginDevices(self.pluginId)) {
                await remote.setNativeId(pluginDevice.nativeId, pluginDevice._id, pluginDevice.storage || {});
            }

            await remote.setSystemState(scrypted.stateManager.getSystemState());
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
                const module = await remote.loadZip(plugin.packageJson, zipBuffer);
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

        init.catch(e => console.error('plugin failed to load', e));

        this.module = init.then(({ module }) => module);
        this.remote = new LazyRemote(init.then(({ remote }) => remote));

        this.listener = scrypted.stateManager.listen((id, eventDetails, eventData) => {
            if (eventDetails.property) {
                const device = scrypted.findPluginDeviceById(id);
                this.remote.notify(id, eventDetails.eventTime, eventDetails.eventInterface, eventDetails.property, device?.state[eventDetails.property], eventDetails.changed);
            }
            else {
                this.remote.notify(id, eventDetails.eventTime, eventDetails.eventInterface, eventDetails.property, eventData, eventDetails.changed);
            }
        });
    }

    startPluginClusterHost(logger: Logger, env?: any) {
        this.worker = cluster.fork(env);

        this.worker.process.stdout.on('data', data => {
            process.stdout.write(data);
        });
        this.worker.process.stderr.on('data', data => process.stderr.write(data));

        let connected = true;
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
        this.worker.on('message', message => this.peer.handleMessage(message));

        this.peer = new RpcPeer((message, reject) => {
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
    const consoleReader = await listenZeroCluster(server);
    const consoleWriter = await listenZeroCluster(writeServer);

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
    return listenZeroCluster(server);
}

export function startPluginClusterWorker() {
    const events = new EventEmitter();

    events.once('zip', (zip: AdmZip) => {
        installSourceMapSupport({
            environment: 'node',
            retrieveSourceMap(source) {
                if (source === '/plugin/main.nodejs.js') {
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
        })
    });

    let systemManager: SystemManager;
    let deviceManager: DeviceManager;

    function idForNativeId(nativeId: ScryptedNativeId) {
        if (!deviceManager)
            return;
        const ds = deviceManager.getDeviceState(nativeId);
        return ds?.id;
    }

    const getConsole = (hook: (stdout: PassThrough, stderr: PassThrough) => Promise<void>) => {

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

        for (const m of methods) {
            const old = (ret as any)[m].bind(ret);
            (ret as any)[m] = (...args: any[]) => {
                (console as any)[m](...args);
                old(...args);
            }
        }

        return ret;
    }

    const getDeviceConsole = (nativeId?: ScryptedNativeId) => {
        return getConsole(async (stdout, stderr) => {
            stdout.on('data', data => events.emit('stdout', data, nativeId));
            stderr.on('data', data => events.emit('stderr', data, nativeId));
        });
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
                const {pluginId, nativeId: mixinNativeId} = await plugins.getDeviceInfo(mixinId);
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
        });
    }

    const peer = new RpcPeer((message, reject) => process.send(message, undefined, {
        swallowErrors: !reject,
    }, e => {
        if (e)
            reject(e);
    }));
    process.on('message', message => peer.handleMessage(message as RpcMessage));

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

class LazyRemote implements PluginRemote {
    init: Promise<PluginRemote>;
    remote: PluginRemote;

    constructor(init: Promise<PluginRemote>) {
        this.init = (async () => {
            this.remote = await init;
            return this.remote;
        })();
    }

    async loadZip(packageJson: any, zipData: Buffer): Promise<any> {
        if (!this.remote)
            await this.init;

        return this.remote.loadZip(packageJson, zipData);
    }
    async setSystemState(state: { [id: string]: { [property: string]: SystemDeviceState; }; }): Promise<void> {
        if (!this.remote)
            await this.init;
        return this.remote.setSystemState(state);
    }
    async setNativeId(nativeId: ScryptedNativeId, id: string, storage: { [key: string]: any; }): Promise<void> {
        if (!this.remote)
            await this.init;
        return this.remote.setNativeId(nativeId, id, storage);
    }
    async updateDescriptor(id: string, state: { [property: string]: SystemDeviceState; }): Promise<void> {
        if (!this.remote)
            await this.init;
        return this.remote.updateDescriptor(id, state);
    }
    async notify(id: string, eventTime: number, eventInterface: string, property: string, propertyState: SystemDeviceState, changed?: boolean): Promise<void> {
        if (!this.remote)
            await this.init;
        return this.remote.notify(id, eventTime, eventInterface, property, propertyState, changed);
    }
    async ioEvent(id: string, event: string, message?: any): Promise<void> {
        if (!this.remote)
            await this.init;
        return this.remote.ioEvent(id, event, message);
    }
    async createDeviceState(id: string, setState: (property: string, value: any) => Promise<void>): Promise<any> {
        if (!this.remote)
            await this.init;
        return this.remote.createDeviceState(id, setState);
    }

    async getServicePort(name: string): Promise<number> {
        if (!this.remote)
            await this.init;
        return this.remote.getServicePort(name);
    }
}
