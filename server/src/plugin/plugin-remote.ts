import AdmZip from 'adm-zip';
import { Volume } from 'memfs';
import path from 'path';
import { DeviceManager, Logger, Device, DeviceManifest, DeviceState, EventDetails, EventListenerOptions, EventListenerRegister, EndpointManager, SystemDeviceState, ScryptedStatic, SystemManager, MediaManager, ScryptedMimeTypes, ScryptedInterface, ScryptedInterfaceProperty, HttpRequest } from '@scrypted/sdk/types'
import { getIpAddress, SCRYPTED_INSECURE_PORT, SCRYPTED_SECURE_PORT } from '../server-settings';
import { PluginAPI, PluginLogger, PluginRemote } from './plugin-api';
import { SystemManagerImpl } from './system';
import { RpcPeer } from '../rpc';
import { BufferSerializer } from './buffer-serializer';
import { EventEmitter } from 'events';
import { createWebSocketClass } from './plugin-remote-websocket';

class DeviceLogger implements Logger {
    nativeId: string;
    api: PluginAPI;
    logger: Promise<PluginLogger>;

    constructor(api: PluginAPI, nativeId: string, public console: any) {
        this.api = api;
        this.nativeId = nativeId;
    }

    async ensureLogger(): Promise<PluginLogger> {
        if (!this.logger)
            this.logger = this.api.getLogger(this.nativeId);
        return await this.logger;
    }

    async log(level: string, message: string) {
        this.console.log(message);
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
    async getPublicPushEndpoint(nativeId?: string): Promise<string> {
        const mo = this.mediaManager.createMediaObject(Buffer.from(this.getEndpoint(nativeId)), ScryptedMimeTypes.PushEndpoint);
        return this.mediaManager.convertMediaObjectToUrl(mo, ScryptedMimeTypes.PushEndpoint);
    }
    async deliverPush(endpoint: string, request: HttpRequest) {
        return this.api.deliverPush(endpoint, request);
    }
}

const disallowedScryptedDeviceProperties = new Set<string>([
    ScryptedInterfaceProperty.id,
    ScryptedInterfaceProperty.interfaces,
    ScryptedInterfaceProperty.mixins,
]);

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
        if (p === ScryptedInterfaceProperty.id)
            throw new Error("id is read only");
        if (p === ScryptedInterfaceProperty.mixins)
            throw new Error("mixins is read only");
        if (p === ScryptedInterfaceProperty.interfaces)
            throw new Error("interfaces is a read only post-mixin computed property, use providedInterfaces");
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

    constructor(systemManager: SystemManagerImpl, public events?: EventEmitter, public getDeviceConsole?: (nativeId?: string) => Console) {
        this.systemManager = systemManager;
    }

    async requestRestart() {
        return this.api.requestRestart();
    }

    getDeviceLogger(nativeId?: string): Logger {
        return new DeviceLogger(this.api, nativeId, this.getDeviceConsole?.(nativeId) || console);
    }

    getDeviceState(nativeId?: any): DeviceState {
        const handler = new DeviceStateProxyHandler(this, this.nativeIds.get(nativeId).id,
            (property, value) => this.api.setState(nativeId, property, value));
        return new Proxy(handler, handler);
    }

    getDeviceStorage(nativeId?: any): StorageImpl {
        return new StorageImpl(this, nativeId);
    }
    getMixinStorage(id: string, nativeId?: string) {
        return new StorageImpl(this, nativeId, `mixin:${id}:`);
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

class StorageImpl implements Storage {
    api: PluginAPI;

    constructor(public deviceManager: DeviceManagerImpl, public nativeId: string, public prefix?: string) {
        this.deviceManager = deviceManager;
        this.api = deviceManager.api;
        this.nativeId = nativeId;
        if (!this.prefix)
            this.prefix = '';
    }

    get storage(): { [key: string]: any } {
        return this.deviceManager.nativeIds.get(this.nativeId).storage;
    }

    get length(): number {
        return Object.keys(this.storage).filter(key => key.startsWith(this.prefix)).length;
    }

    clear(): void {
        if (!this.prefix) {
            this.deviceManager.nativeIds.get(this.nativeId).storage = {};
        }
        else {
            const storage = this.storage;
            Object.keys(this.storage).filter(key => key.startsWith(this.prefix)).forEach(key => delete storage[key]);
        }
        this.api.setStorage(this.nativeId, this.storage);
    }

    getItem(key: string): string {
        return this.storage[this.prefix + key];
    }
    key(index: number): string {
        if (!this.prefix) {
            return Object.keys(this.storage)[index];
        }
        return Object.keys(this.storage).filter(key => key.startsWith(this.prefix))[index].substring(this.prefix.length);
    }
    removeItem(key: string): void {
        delete this.storage[this.prefix + key];
        this.api.setStorage(this.nativeId, this.storage);
    }
    setItem(key: string, value: string): void {
        this.storage[this.prefix + key] = value;
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

    const ret = await peer.eval('return getRemote(api, pluginId)', undefined, {
        api,
        pluginId,
    }, true) as PluginRemote;

    return ret;
}

export interface PluginRemoteAttachOptions {
    createMediaManager?: (systemManager: SystemManager) => Promise<MediaManager>;
    getServicePort?: (name: string) => Promise<number>;
    getDeviceConsole?: (nativeId?: string) => Console;
    events?: EventEmitter;
}

export function attachPluginRemote(peer: RpcPeer, options?: PluginRemoteAttachOptions): Promise<ScryptedStatic> {
    const { createMediaManager, getServicePort, events, getDeviceConsole } = options || {};

    peer.addSerializer(Buffer, 'Buffer', new BufferSerializer());

    let done: (scrypted: ScryptedStatic) => void;
    const retPromise = new Promise<ScryptedStatic>(resolve => done = resolve);

    peer.params.getRemote = async (api: PluginAPI, pluginId: string) => {
        const systemManager = new SystemManagerImpl();
        const deviceManager = new DeviceManagerImpl(systemManager, events, getDeviceConsole);
        const endpointManager = new EndpointManagerImpl();
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
            getServicePort,
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
                deviceManager.nativeIds.set(nativeId?.toString(), {
                    id,
                    storage,
                });
            },

            async updateDescriptor(id: string, state: { [property: string]: SystemDeviceState }) {
                if (!state) {
                    delete systemManager.state[id];
                    systemManager.events.notify(id, Date.now(), ScryptedInterface.ScryptedDevice, ScryptedInterfaceProperty.id, id, true);
                }
                else {
                    systemManager.state[id] = state;
                    systemManager.events.notify(id, Date.now(), ScryptedInterface.ScryptedDevice, undefined, undefined, true);
                }
            },

            async notify(id: string, eventTime: number, eventInterface: string, property: string, value: SystemDeviceState | any, changed?: boolean) {
                if (property) {
                    const state = systemManager.state?.[id];
                    if (!state) {
                        log.w(`state not found for ${id}`);
                        return;
                    }
                    state[property] = value;
                    systemManager.events.notify(id, eventTime, eventInterface, property, value.value, changed);
                }
                else {
                    systemManager.events.notify(id, eventTime, eventInterface, property, value, changed);
                }
            },

            async setSystemState(state: { [id: string]: { [property: string]: SystemDeviceState } }) {
                systemManager.state = state;
                done(ret);
            },
            async loadZip(packageJson: any, zipData: Buffer) {
                const zip = new AdmZip(zipData);
                const main = zip.getEntry('main.nodejs.js');
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

                function websocketConnect(url: string, protocols: any, connect: any, end: any, error: any, data: any) {
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
                }

                const params: any = {
                    window,
                    require: (name: string) => {
                        if (name === 'fs' && !packageJson.scrypted.realfs) {
                            return volume;
                        }
                        if (name === 'realfs') {
                            return require('fs');
                        }
                        const module = require(name);
                        return module;
                    },
                    deviceManager,
                    systemManager,
                    mediaManager,
                    endpointManager,
                    log,
                    localStorage,
                    pluginHostAPI: api,
                    WebSocket: createWebSocketClass(websocketConnect),
                };

                if (getDeviceConsole) {
                    params.console = getDeviceConsole(undefined);
                }

                events?.emit('params', params);

                try {
                    peer.evalLocal(script, '/plugin/main.nodejs.js', params);
                    events?.emit('plugin', exports.default);
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