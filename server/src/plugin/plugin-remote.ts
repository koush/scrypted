import { Device, DeviceManager, DeviceManifest, DeviceState, EndpointManager, HttpRequest, Logger, MediaManager, ScryptedInterface, ScryptedInterfaceProperty, ScryptedMimeTypes, ScryptedNativeId, ScryptedStatic, SystemDeviceState, SystemManager } from '@scrypted/types';
import { RpcPeer, RPCResultError } from '../rpc';
import { BufferSerializer } from './buffer-serializer';
import { PluginAPI, PluginLogger, PluginRemote, PluginRemoteLoadZipOptions } from './plugin-api';
import { createWebSocketClass, WebSocketConnectCallbacks, WebSocketConnection, WebSocketMethods, WebSocketSerializer } from './plugin-remote-websocket';
import { checkProperty } from './plugin-state-check';
import { SystemManagerImpl } from './system';

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
        if (!nativeId)
            return this.pluginId;
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
        const mo = await this.mediaManager.createMediaObject(Buffer.from(local), ScryptedMimeTypes.LocalUrl);
        return this.mediaManager.convertMediaObjectToUrl(mo, ScryptedMimeTypes.LocalUrl);
    }
    async getPublicLocalEndpoint(nativeId?: ScryptedNativeId): Promise<string> {
        return `https://${await this.getUrlSafeIp()}:${await this.api.getComponent('SCRYPTED_SECURE_PORT')}/endpoint/${this.getEndpoint(nativeId)}/public/`;
    }
    async getPublicPushEndpoint(nativeId?: ScryptedNativeId): Promise<string> {
        const mo = await this.mediaManager.createMediaObject(Buffer.from(this.getEndpoint(nativeId)), ScryptedMimeTypes.PushEndpoint);
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
        if (p === RpcPeer.PROPERTY_PROXY_PROPERTIES)
            return { id: this.id }
        if (p === 'setState')
            return this.setState;
        return this.deviceManager.systemManager.state[this.id][p as string]?.value;
    }

    set?(target: any, p: PropertyKey, value: any, receiver: any) {
        checkProperty(p.toString(), value);
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

export class DeviceManagerImpl implements DeviceManager {
    api: PluginAPI;
    nativeIds = new Map<string, DeviceManagerDevice>();
    deviceStorage = new Map<string, StorageImpl>();
    mixinStorage = new Map<string, Map<string, StorageImpl>>();

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

    createDeviceState(id: string, setState: (property: string, value: any) => Promise<void>): DeviceState {
        const handler = new DeviceStateProxyHandler(this, id, setState);
        return new Proxy(handler, handler);
    }

    getDeviceStorage(nativeId?: any): StorageImpl {
        let ret = this.deviceStorage.get(nativeId);
        if (!ret) {
            ret = new StorageImpl(this, nativeId);
            this.deviceStorage.set(nativeId, ret);
        }
        return ret;
    }
    getMixinStorage(id: string, nativeId?: ScryptedNativeId) {
        let ms = this.mixinStorage.get(nativeId);
        if (!ms) {
            ms = new Map();
            this.mixinStorage.set(nativeId, ms);
        }
        let ret = ms.get(id);
        if (!ret) {
            ret = new StorageImpl(this, nativeId, `mixin:${id}:`);
            ms.set(id, ret);
        }
        return ret;
    }
    pruneMixinStorage() {
        for (const nativeId of this.nativeIds.keys()) {
            const storage = this.nativeIds.get(nativeId).storage;
            for (const key of Object.keys(storage)) {
                if (!key.startsWith('mixin:'))
                    continue;
                const [, id,] = key.split(':');
                // there's no rush to persist this, it will happen automatically on the plugin
                // persisting something at some point.
                // the key itself is unreachable due to the device no longer existing.
                if (id && !this.systemManager.state[id])
                    delete storage[key];
            }
        }
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
        if (this.storage[this.prefix + key] === value)
            return;
        this.storage[this.prefix + key] = value;
        this.api.setStorage(this.nativeId, this.storage);
    }
}

export async function setupPluginRemote(peer: RpcPeer, api: PluginAPI, pluginId: string, getSystemState: () => { [id: string]: { [property: string]: SystemDeviceState } }): Promise<PluginRemote> {
    try {
        // the host/remote connection can be from server to plugin (node to node),
        // core plugin to web (node to browser).
        // always add the BufferSerializer, so serialization is gauranteed to work.
        // but in plugin-host, mark Buffer as transport safe.
        if (!peer.constructorSerializerMap.get(Buffer))
            peer.addSerializer(Buffer, 'Buffer', new BufferSerializer());
        const getRemote = await peer.getParam('getRemote');
        const remote = await getRemote(api, pluginId) as PluginRemote;

        await remote.setSystemState(getSystemState());
        api.listen((id, eventDetails, eventData) => {
            // ScryptedDevice events will be handled specially and repropagated by the remote.
            if (eventDetails.eventInterface === ScryptedInterface.ScryptedDevice) {
                if (eventDetails.property === ScryptedInterfaceProperty.id) {
                    // a change on the id property means device was deleted
                    remote.updateDeviceState(eventData, undefined);
                }
                else {
                    // a change on anything else is a descriptor update
                    remote.updateDeviceState(id, getSystemState()[id]);
                }
                return;
            }

            if (eventDetails.property) {
                remote.notify(id, eventDetails.eventTime, eventDetails.eventInterface, eventDetails.property, getSystemState()[id]?.[eventDetails.property], eventDetails.changed).catch(() => {});
            }
            else {
                remote.notify(id, eventDetails.eventTime, eventDetails.eventInterface, eventDetails.property, eventData, eventDetails.changed).catch(() => {});
            }
        });

        return remote;
    }
    catch (e) {
        throw new RPCResultError(peer, 'error while retrieving PluginRemote', e);
    }
}

export interface WebSocketCustomHandler {
    id: string,
    methods: WebSocketMethods;
}

export type PluginReader = (name: string) => Buffer;

export interface PluginRemoteAttachOptions {
    createMediaManager?: (systemManager: SystemManager, deviceManager: DeviceManagerImpl) => Promise<MediaManager>;
    getServicePort?: (name: string, ...args: any[]) => Promise<number>;
    getDeviceConsole?: (nativeId?: ScryptedNativeId) => Console;
    getPluginConsole?: () => Console;
    getMixinConsole?: (id: string, nativeId?: ScryptedNativeId) => Console;
    onLoadZip?: (scrypted: ScryptedStatic, params: any, packageJson: any, zipData: Buffer | string, zipOptions?: PluginRemoteLoadZipOptions) => Promise<any>;
    onGetRemote?: (api: PluginAPI, pluginId: string) => Promise<void>;
}

export function attachPluginRemote(peer: RpcPeer, options?: PluginRemoteAttachOptions): Promise<ScryptedStatic> {
    const { createMediaManager, getServicePort, getDeviceConsole, getMixinConsole } = options || {};

    if (!peer.constructorSerializerMap.get(Buffer))
        peer.addSerializer(Buffer, 'Buffer', new BufferSerializer());

    const ioSockets: { [id: string]: WebSocketConnectCallbacks } = {};
    const websocketSerializer = new WebSocketSerializer();
    peer.addSerializer(WebSocketConnection, WebSocketConnection.name, websocketSerializer);

    let done: (scrypted: ScryptedStatic) => void;
    const retPromise = new Promise<ScryptedStatic>(resolve => done = resolve);

    peer.params.getRemote = async (api: PluginAPI, pluginId: string) => {
        websocketSerializer.WebSocket = createWebSocketClass((url: string, callbacks: WebSocketConnectCallbacks) => {
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
        });

        await options?.onGetRemote?.(api, pluginId);

        const systemManager = new SystemManagerImpl();
        const deviceManager = new DeviceManagerImpl(systemManager, getDeviceConsole, getMixinConsole);
        const endpointManager = new EndpointManagerImpl();
        const hostMediaManager = await api.getMediaManager();
        if (!hostMediaManager) {
            peer.params['createMediaManager'] = async () => createMediaManager(systemManager, deviceManager);
        }
        const mediaManager = hostMediaManager || await createMediaManager(systemManager, deviceManager);
        peer.params['mediaManager'] = mediaManager;

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
            pluginHostAPI: api,
            pluginRemoteAPI: undefined,
        }

        delete peer.params.getRemote;

        endpointManager.api = api;
        endpointManager.deviceManager = deviceManager;
        endpointManager.mediaManager = mediaManager;
        endpointManager.pluginId = pluginId;

        const localStorage = new StorageImpl(deviceManager, undefined);

        const remote: PluginRemote & { [RpcPeer.PROPERTY_JSON_DISABLE_SERIALIZATION]: boolean, [RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS]: string[] } = {
            [RpcPeer.PROPERTY_JSON_DISABLE_SERIALIZATION]: true,
            [RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS]: [
                'notify',
                'updateDeviceState',
                'setSystemState',
                'ioEvent',
                'setNativeId',
            ],
            getServicePort,
            async createDeviceState(id: string, setState: (property: string, value: any) => Promise<void>) {
                return deviceManager.createDeviceState(id, setState);
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
                    systemManager.events.notify(undefined, undefined, ScryptedInterface.ScryptedDevice, ScryptedInterfaceProperty.id, id, true);
                }
                else {
                    systemManager.state[id] = state;
                    systemManager.events.notify(id, undefined, ScryptedInterface.ScryptedDevice, undefined, state, true);
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
                deviceManager.pruneMixinStorage();
                done(ret);
            },

            async loadZip(packageJson: any, zipData: Buffer | string, zipOptions?: PluginRemoteLoadZipOptions) {
                const params: any = {
                    __filename: undefined,
                    deviceManager,
                    systemManager,
                    mediaManager,
                    endpointManager,
                    log,
                    localStorage,
                    pluginHostAPI: api,
                    // TODO:
                    // 10/10/2022: remove this shim from all plugins and server.
                    WebSocket: function (url: any) {
                        if (typeof url === 'string')
                            throw new Error('unsupported websocket');
                        return url;
                    },
                    pluginRuntimeAPI: ret,
                };

                params.pluginRuntimeAPI = ret;

                return options.onLoadZip(ret, params, packageJson, zipData, zipOptions);
            },
        }

        ret.pluginRemoteAPI = remote;

        return remote;
    }

    return retPromise;
}
