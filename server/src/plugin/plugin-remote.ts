import AdmZip from 'adm-zip';
import { Volume } from 'memfs';
import path from 'path';
import { DeviceManager, Logger, Device, DeviceManifest, DeviceState, EventDetails, EventListenerOptions, EventListenerRegister, EndpointManager, SystemDeviceState, ScryptedStatic, SystemManager, MediaManager, ScryptedMimeTypes, ScryptedInterface } from '@scrypted/sdk/types'
import { getIpAddress, SCRYPTED_INSECURE_PORT, SCRYPTED_SECURE_PORT } from '../server-settings';
import { PluginAPI, PluginRemote } from './plugin-api';
import { Logger as ScryptedLogger } from '../logger';
import { SystemManagerImpl } from './system';
import { RpcPeer } from '../rpc';
import { BufferSerializer } from './buffer-serializer';

class DeviceLogger implements Logger {
    nativeId: string;
    api: PluginAPI;
    logger: Promise<ScryptedLogger>;

    constructor(api: PluginAPI, nativeId: string) {
        this.api = api;
        this.nativeId = nativeId;
    }

    async ensureLogger(): Promise<ScryptedLogger> {
        if (!this.logger)
            this.logger = this.api.getLogger(this.nativeId) as Promise<ScryptedLogger>;
        return await this.logger;
    }

    async log(level: string, message: string) {
        console.log(message);
        (await this.ensureLogger()).log(level, message);
    }

    a(msg: string): void {
        this.log('a', msg);
    }
    async clear() {
        (await this.ensureLogger()).clear();
    }
    async clearAlert(msg: string) {
        (await this.ensureLogger()).clearAlert(msg);
    }
    async clearAlerts() {
        (await this.ensureLogger()).clearAlerts();
    }
    d(msg: string): void {
        this.log('d', msg);
    }
    e(msg: string): void {
        this.log('e', msg);
    }
    i(msg: string): void {
        this.log('i', msg);
    }
    v(msg: string): void {
        this.log('v', msg);
    }
    w(msg: string): void {
        this.log('w', msg);
    }
}

class EndpointManagerImpl implements EndpointManager {
    deviceManager: DeviceManagerImpl;
    api: PluginAPI;
    pluginId: string;
    mediaManager: MediaManager;

    getEndpoint(nativeId?: string) {
        if (!nativeId)
            return this.pluginId;
        const id = this.deviceManager.nativeIds.get(nativeId)?.id;
        if (!id)
            throw new Error('invalid nativeId ' + nativeId);
        return id;
    }

    async getAuthenticatedPath(nativeId?: string): Promise<string> {
        return `/endpoint/${this.getEndpoint(nativeId)}/`;
    }
    async getInsecurePublicLocalEndpoint(nativeId?: string): Promise<string> {
        return `http://${getIpAddress()}:${SCRYPTED_INSECURE_PORT}/endpoint/${this.getEndpoint(nativeId)}/public/`;
    }
    async getPublicCloudEndpoint(nativeId?: string): Promise<string> {
        const local = await this.getPublicLocalEndpoint(nativeId);
        const mo = this.mediaManager.createMediaObject(local, ScryptedMimeTypes.LocalUrl);
        return this.mediaManager.convertMediaObjectToUrl(mo, ScryptedMimeTypes.LocalUrl);
    }
    async getPublicLocalEndpoint(nativeId?: string): Promise<string> {
        return `https://${getIpAddress()}:${SCRYPTED_SECURE_PORT}/endpoint/${this.getEndpoint(nativeId)}/public/`;
    }
    getPublicPushEndpoint(nativeId?: string): Promise<string> {
        throw new Error('Method not implemented.');
    }
}

class DeviceStateProxyHandler implements ProxyHandler<any> {
    deviceManager: DeviceManagerImpl;
    id: string;
    setState: (property: string, value: any) => Promise<void>;

    constructor(deviceManager: DeviceManagerImpl, id: string,
        setState: (property: string, value: any) => Promise<void>) {
        // JSON stringify over rpc turns undefined into null.
        this.deviceManager = deviceManager;
        this.id = id;
        this.setState = setState;
    }

    get?(target: any, p: PropertyKey, receiver: any) {
        if (p === 'id')
            return this.id;
        return this.deviceManager.systemManager.state[this.id][p as string]?.value;
    }

    set?(target: any, p: PropertyKey, value: any, receiver: any) {
        if (p === 'id')
            throw new Error("can not change id");
        const now = Date.now();
        this.deviceManager.systemManager.state[this.id][p as string] = {
            lastEventTime: now,
            stateTime: now,
            value,
        };
        this.setState(p.toString(), value);
        return true;
    }
}

interface DeviceManagerDevice {
    id: string;
    storage: { [key: string]: any };
}

class DeviceManagerImpl implements DeviceManager {
    api: PluginAPI;
    nativeIds = new Map<string, DeviceManagerDevice>();
    systemManager: SystemManagerImpl;

    constructor(systemManager: SystemManagerImpl) {
        this.systemManager = systemManager;
    }

    getDeviceLogger(nativeId?: string): Logger {
        return new DeviceLogger(this.api, nativeId);
    }

    getDeviceState(nativeId?: any): DeviceState {
        const handler = new DeviceStateProxyHandler(this, this.nativeIds.get(nativeId).id,
            (property, value) => this.api.setState(nativeId, property, value));
        return new Proxy(handler, handler);
    }

    getDeviceStorage(nativeId?: any): StorageImpl {
        return new StorageImpl(this, nativeId);
    }
    getNativeIds(): string[] {
        return Array.from(this.nativeIds.keys());
    }
    async onDeviceDiscovered(device: Device) {
        return this.api.onDeviceDiscovered(device);
    }
    async onDeviceRemoved(nativeId: string) {
        return this.api.onDeviceRemoved(nativeId);
    }
    async onDeviceEvent(nativeId: any, eventInterface: any, eventData?: any) {
        return this.api.onDeviceEvent(nativeId, eventInterface, eventData);
    }
    async onDevicesChanged(devices: DeviceManifest) {
        return this.api.onDevicesChanged(devices);
    }
}


class PushManagerImpl implements PushManager {
    getSubscription(): Promise<PushSubscription> {
        throw new Error('Method not implemented.');
    }
    permissionState(options?: PushSubscriptionOptionsInit): Promise<PushPermissionState> {
        throw new Error('Method not implemented.');
    }
    subscribe(options?: PushSubscriptionOptionsInit): Promise<PushSubscription> {
        throw new Error('Method not implemented.');
    }

    getRegistrationId(): string {
        return 'no-registration-id-fix-this';
    }

    getSenderId(): string {
        return 'no-sender-id-fix-this';
    }
}

class StorageImpl implements Storage {
    nativeId: string;
    api: PluginAPI;
    deviceManager: DeviceManagerImpl;

    constructor(deviceManager: DeviceManagerImpl, nativeId: string) {
        this.deviceManager = deviceManager;
        this.api = deviceManager.api;
        this.nativeId = nativeId;
    }

    get storage(): { [key: string]: any } {
        return this.deviceManager.nativeIds.get(this.nativeId).storage;
    }

    get length(): number {
        return Object.keys(this.storage).length;
    }

    clear(): void {
        this.deviceManager.nativeIds.get(this.nativeId).storage = {};
        this.api.setStorage(this.nativeId, this.storage);
    }

    getItem(key: string): string {
        return this.storage[key];
    }
    key(index: number): string {
        return Object.keys(this.storage)[index];
    }
    removeItem(key: string): void {
        delete this.storage[key];
        this.api.setStorage(this.nativeId, this.storage);
    }
    setItem(key: string, value: string): void {
        this.storage[key] = value;
        this.api.setStorage(this.nativeId, this.storage);
    }
}

interface WebSocketCallbacks {
    end: any;
    error: any;
    data: any;
}


export async function setupPluginRemote(peer: RpcPeer, api: PluginAPI, pluginId: string): Promise<PluginRemote> {
    peer.addSerializer(Buffer, 'Buffer', new BufferSerializer());

    const listen = api.listen.bind(api);

    const registers = new Set<EventListenerRegister>();

    class EventListenerRegisterObserver implements EventListenerRegister {
        register: EventListenerRegister;

        constructor(register: EventListenerRegister) {
            this.register = register;
        }

        removeListener() {
            registers.delete(this.register);
            this.register.removeListener();
        }
    }

    function manage(register: EventListenerRegister): EventListenerRegister {
        registers.add(register);
        return new EventListenerRegisterObserver(register);
    }

    api.listen = async (EventListener: (id: string, eventDetails: EventDetails, eventData: object) => void) => {
        return manage(await listen(EventListener));
    }

    const listenDevice = api.listenDevice.bind(api);
    api.listenDevice = async (id: string, event: string | EventListenerOptions, callback: (eventDetails: EventDetails, eventData: object) => void): Promise<EventListenerRegister> => {
        return manage(await listenDevice(id, event, callback));
    }

    api.kill = async () => {
        for (const register of registers) {
            register.removeListener();
        }
    }

    const ret = await peer.eval('return getRemote(api, pluginId)', undefined, {
        api,
        pluginId,
    }, true) as PluginRemote;

    return ret;
}

export async function attachPluginRemote(peer: RpcPeer, createMediaManager?: (systemManager: SystemManager) => Promise<MediaManager>): Promise<ScryptedStatic> {
    peer.addSerializer(Buffer, 'Buffer', new BufferSerializer());

    let done: any;
    const retPromise = new Promise<ScryptedStatic>((resolve, reject) => {
        done = resolve;
    });

    peer.params.getRemote = async (api: PluginAPI, pluginId: string) => {
        const systemManager = new SystemManagerImpl();
        const deviceManager = new DeviceManagerImpl(systemManager);
        const endpointManager = new EndpointManagerImpl();
        const pushManager = new PushManagerImpl();
        const ioSockets: { [id: string]: WebSocketCallbacks } = {};
        const mediaManager = await api.getMediaManager() || await createMediaManager(systemManager);

        systemManager.api = api;
        deviceManager.api = api;
        const log = deviceManager.getDeviceLogger(undefined);
        systemManager.log = log;

        const ret: ScryptedStatic = {
            systemManager,
            deviceManager,
            endpointManager,
            mediaManager,
            log,
        }

        delete peer.params.getRemote;

        endpointManager.api = api;
        endpointManager.deviceManager = deviceManager;
        endpointManager.mediaManager = mediaManager;
        endpointManager.pluginId = pluginId;

        const localStorage = new StorageImpl(deviceManager, undefined);

        const remote: PluginRemote = {
            createDeviceState(id: string, setState: (property: string, value: any) => Promise<void>) {
                const handler = new DeviceStateProxyHandler(deviceManager, id, setState);
                return new Proxy(handler, handler);
            },

            async ioEvent(id: string, event: string, message?: any) {
                // console.log(id, event, message);
                const io = ioSockets[id];
                if (!io)
                    return;
                switch (event) {
                    case 'message':
                        io.data(message);
                        break;
                    case 'close':
                        io.end();
                        delete ioSockets[id];
                        break;
                }
            },

            async setNativeId(nativeId: string, id: string, storage: { [key: string]: any }) {
                // JSON stringify over rpc turns undefined into null.
                if (nativeId === null)
                    nativeId = undefined;
                deviceManager.nativeIds.set(nativeId, {
                    id,
                    storage,
                });
            },

            async updateDescriptor(id: string, state: { [property: string]: SystemDeviceState }) {
                // possible for state messages to be sent before state initialization.
                if (systemManager.state) {
                    if (!state)
                        delete systemManager.state[id];
                    else
                        systemManager.state[id] = state;
                }

                systemManager.events.notify(id, state, ScryptedInterface.ScryptedDevice, undefined, undefined, true);
            },

            async updateProperty(id: string, eventInterface: string, property: string, propertyState: SystemDeviceState, changed?: boolean) {
                const state = systemManager.state?.[id];
                if (!state) {
                    log.w(`${state} not found for ${id}`);
                    return;
                }
                state[property] = propertyState;
                systemManager.events.notify(id, state, eventInterface, property, propertyState.value, changed);
            },

            async setSystemState(state: { [id: string]: { [property: string]: SystemDeviceState } }) {
                systemManager.state = state;
                done(ret);
            },
            async loadZip(zipData: Buffer) {
                const zip = new AdmZip(zipData);
                const main = zip.getEntry('main.nodejs.js')
                const script = main.getData().toString();
                const window: any = {};
                const exports: any = window;
                window.exports = exports;

                const volume = new Volume();
                for (const entry of zip.getEntries()) {
                    if (entry.isDirectory)
                        continue;
                    if (!entry.entryName.startsWith('fs/'))
                        continue;
                    const name = entry.entryName.substr('fs/'.length);
                    volume.mkdirpSync(path.dirname(name));
                    volume.writeFileSync(name, entry.getData());
                }

                const params = {
                    // legacy
                    android: {},

                    __websocketConnect(url: string, protocols: any, connect: any, end: any, error: any, data: any) {
                        if (url.startsWith('io://')) {
                            const id = url.substring('io://'.length);

                            ioSockets[id] = {
                                data,
                                error,
                                end
                            };
    
                            connect(undefined, {
                                close: () => api.ioClose(id),
                            }, (message: string) => api.ioSend(id, message));
                        }
                        else if (url.startsWith('ws://')) {
                            const id = url.substring('ws://'.length);

                            ioSockets[id] = {
                                data,
                                error,
                                end
                            };
    
                            connect(undefined, {
                                close: () => api.ioClose(id),
                            }, (message: string) => api.ioSend(id, message));
                        }
                        else {
                            throw new Error('unsupported websocket');
                        }
                    },

                    window,
                    require: (name: string) => {
                        if (name === 'fs') {
                            return volume;
                        }
                        if (name === 'realfs') {
                            return require('fs');
                        }
                        const module = require(name);
                        return module;
                    },
                    pushManager,
                    deviceManager,
                    systemManager,
                    mediaManager,
                    endpointManager,
                    log,
                    localStorage,
                    zwaveManager: null as any,
                }

                try {
                    peer.evalLocal(script, '/plugin/main.nodejs.js', params);
                    return exports.default;
                }
                catch (e) {
                    console.error(e);
                }
            },
        }

        return remote;
    }

    return retPromise;
}