import cluster from 'cluster';
import { RpcPeer } from '../rpc';
import AdmZip from 'adm-zip';
import { ScryptedDevice, Device, DeviceManifest, EventDetails, EventListenerOptions, EventListenerRegister, EngineIOHandler, ScryptedInterfaceProperty, MediaManager, SystemDeviceState } from '@scrypted/sdk/types'
import { ScryptedRuntime } from '../runtime';
import { Plugin } from '../db-types';
import io from 'engine.io';
import { attachPluginRemote, setupPluginRemote } from './plugin-remote';
import { PluginAPI, PluginRemote } from './plugin-api';
import { Logger } from '../logger';
import { MediaManagerImpl } from './media';
import { getState } from '../state';
import WebSocket from 'ws';

export class PluginHost {
    worker: cluster.Worker;
    peer: RpcPeer;
    pluginId: string;
    module: Promise<any>;
    scrypted: ScryptedRuntime;
    console: Promise<Console>;
    remote: PluginRemote;
    zip: AdmZip;
    io = io();
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
        setTimeout(() => this.peer.kill('plugin killed'), 500);
    }

    toString() {
        return this.pluginName || 'no plugin name';
    }

    constructor(scrypted: ScryptedRuntime, plugin: Plugin) {
        this.scrypted = scrypted;
        this.pluginId = plugin._id;
        this.worker = cluster.fork();
        this.pluginName = plugin.packageJson?.name;
        const logger = scrypted.getDeviceLogger(scrypted.findPluginDevice(plugin._id));

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

        this.peer = new RpcPeer(message => { if (connected) this.worker.send(message) });

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
                scrypted.stateManager.notifyInterfaceEvent(plugin, eventInterface, undefined, eventData, true);
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

        const init = (async () => {
            const remote = await setupPluginRemote(this.peer, this.api, self.pluginId);

            for (const pluginDevice of scrypted.findPluginDevices(self.pluginId)) {
                await remote.setNativeId(pluginDevice.nativeId, pluginDevice._id, pluginDevice.storage || {});
            }

            await remote.setSystemState(scrypted.stateManager.getSystemState());
            try {
                const module = await remote.loadZip(zipBuffer);
                logger.log('i', `loaded ${this.pluginName}`);
                return {module, remote};
            }
            catch (e) {
                logger.log('e', `plugin load error ${e}`);
                console.error('plugin load error', e);
                throw e;
            }
        })();

        init.catch(e => console.error('plugin failed to load', e));

        this.module = init.then(({module}) => module);
        this.remote = new LazyRemote(init.then(({remote}) => remote));
    }
}

export async function startPluginCluster() {
    const peer = new RpcPeer(message => process.send(message));
    process.on('message', message => peer.handleMessage(message));
    const scrypted = await attachPluginRemote(peer, async (systemManager) => new MediaManagerImpl(systemManager));
    process.on('uncaughtException', e => {
        scrypted.log.e('uncaughtException');
        scrypted.log.e(e.toString());
        scrypted.log.e(e.stack);
    });
    process.on('unhandledRejection', e => {
        scrypted.log.e('unhandledRejection');
        scrypted.log.e(e.toString());
    });
}

class LazyRemote implements PluginRemote {
    init: Promise<PluginRemote>;

    constructor(init: Promise<PluginRemote>) {
        this.init = init;
    }

    async loadZip(zipData: Buffer): Promise<any> {
        return (await this.init).loadZip(zipData);
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
    async updateProperty(id: string, eventInterface: string, property: string, propertyState: SystemDeviceState, changed?: boolean): Promise<void> {
        return (await this.init).updateProperty(id, eventInterface, property, propertyState, changed);
    }
    async ioEvent(id: string, event: string, message?: any): Promise<void> {
        return (await this.init).ioEvent(id, event, message);
    }
    async createDeviceState(id: string, setState: (property: string, value: any) => Promise<void>): Promise<any> {
        return (await this.init).createDeviceState(id, setState);
    }
}