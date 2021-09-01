import cluster from 'cluster';
import { RpcMessage, RpcPeer } from '../rpc';
import AdmZip from 'adm-zip';
import { ScryptedDevice, Device, DeviceManifest, EventDetails, EventListenerOptions, EventListenerRegister, EngineIOHandler, ScryptedInterfaceProperty, MediaManager, SystemDeviceState, ScryptedStatic } from '@scrypted/sdk/types'
import { ScryptedRuntime } from '../runtime';
import { Plugin } from '../db-types';
import io from 'engine.io';
import { attachPluginRemote, setupPluginRemote } from './plugin-remote';
import { PluginAPI, PluginRemote } from './plugin-api';
import { Logger } from '../logger';
import { MediaManagerImpl } from './media';
import { getState } from '../state';
import WebSocket, { EventEmitter } from 'ws';
import { listenZeroCluster } from './cluster-helper';
import { Server } from 'net';
import repl, { REPLServer } from 'repl';
import { once } from 'events';
import { PassThrough } from 'stream';
import { Console } from 'console'
import util from 'util';

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
    api: PluginAPI;
    pluginName: string;

    kill() {
        this.api.kill();
        this.worker.process.kill();
        this.io.close();
        for (const s of Object.values(this.ws)) {
            s.close();
        }
        this.ws = {};

        for (const device of Object.values(this.scrypted.devices)) {
            const pluginDevice = this.scrypted.pluginDevices[device.handler.id];
            for (const mixin of pluginDevice?.mixins || []) {
                if (this.scrypted.findPluginDeviceById(mixin).pluginId === this.pluginId) {
                    device.handler.invalidate();
                }
            }
        }
        setTimeout(() => this.peer.kill('plugin killed'), 500);
    }

    toString() {
        return this.pluginName || 'no plugin name';
    }

    constructor(scrypted: ScryptedRuntime, plugin: Plugin, waitDebug?: Promise<void>) {
        this.scrypted = scrypted;
        this.pluginId = plugin._id;
        this.pluginName = plugin.packageJson?.name;
        const logger = scrypted.getDeviceLogger(scrypted.findPluginDevice(plugin._id));

        if (true) {
            this.worker = cluster.fork();
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
                    reject(new Error('peer'));
                }
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
                createMediaManager: async (systemManager) => new MediaManagerImpl(systemManager),
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

        async function upsertDevice(upsert: Device) {
            const pi = await scrypted.upsertDevice(self.pluginId, upsert);
            await self.remote.setNativeId(pi.nativeId, pi._id, pi.storage || {});
            scrypted.invalidatePluginDevice(pi._id);
        }

        class PluginAPIImpl implements PluginAPI {
            getMediaManager(): Promise<MediaManager> {
                return null;
            }

            async getLogger(nativeId: string): Promise<Logger> {
                const device = scrypted.findPluginDevice(plugin._id, nativeId);
                return self.scrypted.getDeviceLogger(device);
            }

            getComponent(id: string): Promise<any> {
                return self.scrypted.getComponent(id);
            }

            setDeviceProperty(id: string, property: ScryptedInterfaceProperty, value: any): Promise<void> {
                switch (property) {
                    case ScryptedInterfaceProperty.room:
                    case ScryptedInterfaceProperty.type:
                    case ScryptedInterfaceProperty.name:
                        const device = scrypted.findPluginDeviceById(id);
                        scrypted.stateManager.setPluginDeviceState(device, property, value);
                        return;
                    default:
                        throw new Error(`Not allowed to set property ${property}`);
                }
            }

            async ioClose(id: string) {
                self.io.clients[id]?.close();
                self.ws[id]?.close();
            }

            async ioSend(id: string, message: string) {
                self.io.clients[id]?.send(message);
                self.ws[id]?.send(message);
            }

            async setState(nativeId: string, key: string, value: any) {
                scrypted.stateManager.setPluginState(self.pluginId, nativeId, key, value);
            }

            async setStorage(nativeId: string, storage: { [key: string]: string }) {
                const device = scrypted.findPluginDevice(plugin._id, nativeId)
                device.storage = storage;
                scrypted.datastore.upsert(device);
            }

            async onDevicesChanged(deviceManifest: DeviceManifest) {
                const existing = scrypted.findPluginDevices(self.pluginId);
                const newIds = deviceManifest.devices.map(device => device.nativeId);
                const toRemove = existing.filter(e => e.nativeId && !newIds.includes(e.nativeId));

                for (const remove of toRemove) {
                    await scrypted.removeDevice(remove);
                }

                for (const upsert of deviceManifest.devices) {
                    await upsertDevice(upsert);
                }
            }

            async onDeviceDiscovered(device: Device) {
                await upsertDevice(device);
            }

            async onDeviceRemoved(nativeId: string) {
                await scrypted.removeDevice(scrypted.findPluginDevice(plugin._id, nativeId))
            }

            async onDeviceEvent(nativeId: any, eventInterface: any, eventData?: any) {
                const plugin = scrypted.findPluginDevice(self.pluginId, nativeId);
                scrypted.stateManager.notifyInterfaceEvent(plugin, eventInterface, eventData);
            }

            async getDeviceById<T>(id: string): Promise<T & ScryptedDevice> {
                return scrypted.getDevice(id);
            }
            async listen(EventListener: (id: string, eventDetails: EventDetails, eventData: object) => void): Promise<EventListenerRegister> {
                return scrypted.stateManager.listen(EventListener);
            }
            async listenDevice(id: string, event: string | EventListenerOptions, callback: (eventDetails: EventDetails, eventData: object) => void): Promise<EventListenerRegister> {
                const device = scrypted.findPluginDeviceById(id);
                if (device) {
                    const self = scrypted.findPluginDevice(plugin._id);
                    scrypted.getDeviceLogger(self).log('i', `requested listen ${getState(device, ScryptedInterfaceProperty.name)} ${JSON.stringify(event)}`);
                }
                return scrypted.stateManager.listenDevice(id, event, callback);
            }

            async removeDevice(id: string) {
                return scrypted.removeDevice(scrypted.findPluginDeviceById(id));
            }

            async kill() {
            }
        }
        this.api = new PluginAPIImpl();

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
                }
                catch (e) {
                    console.error('debugger failed', e);
                }
            }
            try {
                const module = await remote.loadZip(plugin.packageJson, zipBuffer);
                logger.log('i', `loaded ${this.pluginName}`);
                return { module, remote };
            }
            catch (e) {
                logger.log('e', `plugin load error ${e}`);
                console.error('plugin load error', e);
                throw e;
            }
        })();

        init.catch(e => console.error('plugin failed to load', e));

        this.module = init.then(({ module }) => module);
        this.remote = new LazyRemote(init.then(({ remote }) => remote));
    }
}

async function createConsoleServer(events: EventEmitter): Promise<number> {
    const outputs = new Map<string, Buffer[]>();
    const appendOutput = (data: Buffer, nativeId: string) => {
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

        const cb = (data: Buffer, nativeId: string) => {
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
    return listenZeroCluster(server);
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

        const replVariables = Object.keys(ctx).filter(key => key !== 'require');

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

    const getDeviceConsole = (nativeId?: string) => {
        const stdout = new PassThrough();
        const stderr = new PassThrough();

        stdout.on('data', data => events.emit('stdout', data, nativeId));
        stderr.on('data', data => events.emit('stderr', data, nativeId));

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

    const peer = new RpcPeer((message, reject) => process.send(message, undefined, {
        swallowErrors: !reject,
    }, e => {
        if (e)
            reject(e);
    }));
    process.on('message', message => peer.handleMessage(message as RpcMessage));

    const consolePort = createConsoleServer(events);
    const replPort = createREPLServer(events);

    attachPluginRemote(peer, {
        createMediaManager: async (systemManager) => new MediaManagerImpl(systemManager),
        events,
        getDeviceConsole,
        async getServicePort(name) {
            if (name === 'repl')
                return replPort;
            if (name === 'console')
                return consolePort;
            throw new Error(`unknown service ${name}`);
        }
    }).then(scrypted => {
        events.emit('scrypted', scrypted);

        process.on('uncaughtException', e => {
            scrypted.log.e('uncaughtException');
            scrypted.log.e(e.toString());
            scrypted.log.e(e.stack);
        });
        process.on('unhandledRejection', e => {
            scrypted.log.e('unhandledRejection');
            scrypted.log.e(e.toString());
        });
    })
}

class LazyRemote implements PluginRemote {
    init: Promise<PluginRemote>;

    constructor(init: Promise<PluginRemote>) {
        this.init = init;
    }

    async loadZip(packageJson: any, zipData: Buffer): Promise<any> {
        return (await this.init).loadZip(packageJson, zipData);
    }
    async setSystemState(state: { [id: string]: { [property: string]: SystemDeviceState; }; }): Promise<void> {
        return (await this.init).setSystemState(state);
    }
    async setNativeId(nativeId: string, id: string, storage: { [key: string]: any; }): Promise<void> {
        return (await this.init).setNativeId(nativeId, id, storage);
    }
    async updateDescriptor(id: string, state: { [property: string]: SystemDeviceState; }): Promise<void> {
        return (await this.init).updateDescriptor(id, state);
    }
    async notify(id: string, eventTime: number, eventInterface: string, property: string, propertyState: SystemDeviceState, changed?: boolean): Promise<void> {
        return (await this.init).notify(id, eventTime, eventInterface, property, propertyState, changed);
    }
    async ioEvent(id: string, event: string, message?: any): Promise<void> {
        return (await this.init).ioEvent(id, event, message);
    }
    async createDeviceState(id: string, setState: (property: string, value: any) => Promise<void>): Promise<any> {
        return (await this.init).createDeviceState(id, setState);
    }

    async getServicePort(name: string): Promise<number> {
        return (await this.init).getServicePort(name);
    }
}
