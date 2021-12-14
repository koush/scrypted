import AdmZip from 'adm-zip';
import { Volume } from 'memfs';
import path from 'path';
import { ScryptedNativeId, DeviceManager, Logger, Device, DeviceManifest, DeviceState, EndpointManager, SystemDeviceState, ScryptedStatic, SystemManager, MediaManager, ScryptedMimeTypes, ScryptedInterface, ScryptedInterfaceProperty, HttpRequest } from '@scrypted/sdk/types'
import { PluginAPI, PluginLogger, PluginRemote, PluginRemoteLoadZipOptions } from './plugin-api';
import { SystemManagerImpl } from './system';
import { RpcPeer, RPCResultError, PROPERTY_PROXY_ONEWAY_METHODS, PROPERTY_JSON_DISABLE_SERIALIZATION } from '../rpc';
import { BufferSerializer } from './buffer-serializer';
import { createWebSocketClass, WebSocketConnectCallbacks, WebSocketMethods } from './plugin-remote-websocket';

class DeviceLogger implements Logger {
    nativeId: ScryptedNativeId;
    api: PluginAPI;
    logger: Promise<PluginLogger>;

    constructor(api: PluginAPI, nativeId: ScryptedNativeId, public console: any) {
        this.api = api;
        this.nativeId = nativeId;
    }

    async ensureLogger(): Promise<PluginLogger> {
        if (!this.logger)
            this.logger = this.api.getLogger(this.nativeId);
        return await this.logger;
    }

    async log(level: string, message: string) {
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

    getEndpoint(nativeId?: ScryptedNativeId) {
        if (!nativeId)
            return this.pluginId;
        const id = this.deviceManager.nativeIds.get(nativeId)?.id;
        if (!id)
            throw new Error('invalid nativeId ' + nativeId);
        return id;
    }

    async getUrlSafeIp() {
        // ipv6 addresses have colons and need to be bracketed for url safety
        const ip: string = await this.api.getComponent('SCRYPTED_IP_ADDRESS')
        return ip?.includes(':') ? `[${ip}]` : ip;
    }

    async getAuthenticatedPath(nativeId?: ScryptedNativeId): Promise<string> {
        return `/endpoint/${this.getEndpoint(nativeId)}/`;
    }
    async getInsecurePublicLocalEndpoint(nativeId?: ScryptedNativeId): Promise<string> {
        return `http://${await this.getUrlSafeIp()}:${await this.api.getComponent('SCRYPTED_INSECURE_PORT')}/endpoint/${this.getEndpoint(nativeId)}/public/`;
    }
    async getPublicCloudEndpoint(nativeId?: ScryptedNativeId): Promise<string> {
        const local = await this.getPublicLocalEndpoint(nativeId);
        const mo = this.mediaManager.createMediaObject(local, ScryptedMimeTypes.LocalUrl);
        return this.mediaManager.convertMediaObjectToUrl(mo, ScryptedMimeTypes.LocalUrl);
    }
    async getPublicLocalEndpoint(nativeId?: ScryptedNativeId): Promise<string> {
        return `https://${await this.getUrlSafeIp()}:${await this.api.getComponent('SCRYPTED_SECURE_PORT')}/endpoint/${this.getEndpoint(nativeId)}/public/`;
    }
    async getPublicPushEndpoint(nativeId?: ScryptedNativeId): Promise<string> {
        const mo = this.mediaManager.createMediaObject(Buffer.from(this.getEndpoint(nativeId)), ScryptedMimeTypes.PushEndpoint);
        return this.mediaManager.convertMediaObjectToUrl(mo, ScryptedMimeTypes.PushEndpoint);
    }
    async deliverPush(endpoint: string, request: HttpRequest) {
        return this.api.deliverPush(endpoint, request);
    }
}

class DeviceStateProxyHandler implements ProxyHandler<any> {
    constructor(public deviceManager: DeviceManagerImpl, public id: string,
        public setState: (property: string, value: any) => Promise<void>) {
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

    constructor(public systemManager: SystemManagerImpl,
        public getDeviceConsole?: (nativeId?: ScryptedNativeId) => Console,
        public getMixinConsole?: (mixinId: string, nativeId?: ScryptedNativeId) => Console) {
    }

    async requestRestart() {
        return this.api.requestRestart();
    }

    getDeviceLogger(nativeId?: ScryptedNativeId): Logger {
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
    getMixinStorage(id: string, nativeId?: ScryptedNativeId) {
        return new StorageImpl(this, nativeId, `mixin:${id}:`);
    }
    async onMixinEvent(id: string, nativeId: ScryptedNativeId, eventInterface: string, eventData: any) {
        return this.api.onMixinEvent(id, nativeId, eventInterface, eventData);
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
    [name: string]: any;

    private static allowedMethods = [
        'length',
        'clear',
        'getItem',
        'setItem',
        'key',
        'removeItem',
    ];
    private static indexedHandler: ProxyHandler<StorageImpl> = {
        get(target, property) {
            if (StorageImpl.allowedMethods.includes(property.toString())) {
                const prop = property.toString();
                const f = target[property.toString()];
                if (prop === 'length')
                    return f;
                return f.bind(target);
            }
            return target.getItem(property.toString());
        },
        set(target, property, value): boolean {
            target.setItem(property.toString(), value);
            return true;
        }
    };

    constructor(public deviceManager: DeviceManagerImpl, public nativeId: ScryptedNativeId, public prefix?: string) {
        this.deviceManager = deviceManager;
        this.api = deviceManager.api;
        this.nativeId = nativeId;
        if (!this.prefix)
            this.prefix = '';

        return new Proxy(this, StorageImpl.indexedHandler);
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

export async function setupPluginRemote(peer: RpcPeer, api: PluginAPI, pluginId: string): Promise<PluginRemote> {
    try {
        // the host/remote connection can be from server to plugin (node to node),
        // core plugin to web (node to browser).
        // always add the BufferSerializer, so serialization is gauranteed to work.
        // but in plugin-host, mark Buffer as transport safe.
        peer.addSerializer(Buffer, 'Buffer', new BufferSerializer());
        const getRemote = await peer.getParam('getRemote');
        return await getRemote(api, pluginId);
    }
    catch (e) {
        throw new RPCResultError(peer, 'error while retrieving PluginRemote', e);
    }
}

export interface WebSocketCustomHandler {
    id: string,
    methods: WebSocketMethods;
}

export interface PluginRemoteAttachOptions {
    createMediaManager?: (systemManager: SystemManager) => Promise<MediaManager>;
    getServicePort?: (name: string, ...args: any[]) => Promise<number>;
    getDeviceConsole?: (nativeId?: ScryptedNativeId) => Console;
    getPluginConsole?: () => Console;
    getMixinConsole?: (id: string, nativeId?: ScryptedNativeId) => Console;
    onLoadZip?: (zip: AdmZip, packageJson: any) => Promise<void>;
    onGetRemote?: (api: PluginAPI, pluginId: string) => Promise<void>;
    onPluginReady?: (scrypted: ScryptedStatic, params: any, plugin: any) => Promise<void>;
}

export function attachPluginRemote(peer: RpcPeer, options?: PluginRemoteAttachOptions): Promise<ScryptedStatic> {
    const { createMediaManager, getServicePort, getDeviceConsole, getMixinConsole, getPluginConsole } = options || {};

    peer.addSerializer(Buffer, 'Buffer', new BufferSerializer());

    let done: (scrypted: ScryptedStatic) => void;
    const retPromise = new Promise<ScryptedStatic>(resolve => done = resolve);

    peer.params.getRemote = async (api: PluginAPI, pluginId: string) => {
        await options?.onGetRemote?.(api, pluginId);

        const systemManager = new SystemManagerImpl();
        const deviceManager = new DeviceManagerImpl(systemManager, getDeviceConsole, getMixinConsole);
        const endpointManager = new EndpointManagerImpl();
        const mediaManager = await api.getMediaManager() || await createMediaManager(systemManager);
        const ioSockets: { [id: string]: WebSocketConnectCallbacks } = {};

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

        const remote: PluginRemote & { [PROPERTY_JSON_DISABLE_SERIALIZATION]: boolean, [PROPERTY_PROXY_ONEWAY_METHODS]: string[] } = {
            [PROPERTY_JSON_DISABLE_SERIALIZATION]: true,
            [PROPERTY_PROXY_ONEWAY_METHODS]: [
                'notify',
                'updateDeviceState',
                'setSystemState',
                'ioEvent',
                'setNativeId',
            ],
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

            async setNativeId(nativeId: ScryptedNativeId, id: string, storage: { [key: string]: any }) {
                // JSON stringify over rpc turns undefined into null.
                if (nativeId === null)
                    nativeId = undefined;
                if (id) {
                    deviceManager.nativeIds.set(nativeId?.toString(), {
                        id,
                        storage,
                    });
                }
                else {
                    deviceManager.nativeIds.delete(nativeId);
                }
            },

            async updateDeviceState(id: string, state: { [property: string]: SystemDeviceState }) {
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

            async loadZip(packageJson: any, zipData: Buffer, zipOptions?: PluginRemoteLoadZipOptions) {
                const pluginConsole = getPluginConsole?.();
                const zip = new AdmZip(zipData);
                await options?.onLoadZip?.(zip, packageJson);
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

                function websocketConnect(url: string, protocols: any, callbacks: WebSocketConnectCallbacks) {
                    if (url.startsWith('io://') || url.startsWith('ws://')) {
                        const id = url.substring('xx://'.length);

                        ioSockets[id] = callbacks;

                        callbacks.connect(undefined, {
                            close: () => api.ioClose(id),
                            send: (message: string) => api.ioSend(id, message),
                        });
                    }
                    else {
                        throw new Error('unsupported websocket');
                    }
                }

                const params: any = {
                    __filename: undefined,
                    exports,
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

                params.console = pluginConsole;

                try {
                    peer.evalLocal(script, zipOptions?.filename || '/plugin/main.nodejs.js', params);
                    pluginConsole?.log('plugin successfully loaded');
                    await options?.onPluginReady?.(ret, params, exports.default);
                    return exports.default;
                }
                catch (e) {
                    pluginConsole?.error('plugin failed to load', e);
                    throw e;
                }
            },
        }

        return remote;
    }

    return retPromise;
}
