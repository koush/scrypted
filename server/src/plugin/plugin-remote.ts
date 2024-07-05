import { Device, DeviceManager, DeviceManifest, DeviceState, EndpointAccessControlAllowOrigin, EndpointManager, EventDetails, Logger, MediaManager, ScryptedInterface, ScryptedInterfaceProperty, ScryptedMimeTypes, ScryptedNativeId, ScryptedStatic, SystemDeviceState, SystemManager, WritableDeviceState } from '@scrypted/types';
import { RpcPeer, RPCResultError } from '../rpc';
import { AccessControls } from './acl';
import { BufferSerializer } from '../rpc-buffer-serializer';
import { PluginAPI, PluginHostInfo, PluginLogger, PluginRemote, PluginRemoteLoadZipOptions } from './plugin-api';
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

    /**
     * @deprecated
     */
    async getAuthenticatedPath(nativeId?: ScryptedNativeId): Promise<string> {
        return this.getPath(nativeId);
    }

    /**
     * @deprecated
     */
    async getInsecurePublicLocalEndpoint(nativeId?: ScryptedNativeId): Promise<string> {
        return this.getLocalEndpoint(nativeId, {
            insecure: true,
            public: true,
        })
    }

    /**
     * @deprecated
     */
    async getPublicCloudEndpoint(nativeId?: ScryptedNativeId): Promise<string> {
        return this.getCloudEndpoint(nativeId, {
            public: true,
        });
    }

    /**
     * @deprecated
     */
    async getPublicLocalEndpoint(nativeId?: ScryptedNativeId): Promise<string> {
        return this.getLocalEndpoint(nativeId, {
            public: true,
        })
    }

    /**
     * @deprecated
     */
    async getPublicPushEndpoint(nativeId?: ScryptedNativeId): Promise<string> {
        const mo = await this.mediaManager.createMediaObject(Buffer.from(this.getEndpoint(nativeId)), ScryptedMimeTypes.PushEndpoint);
        return this.mediaManager.convertMediaObjectToUrl(mo, ScryptedMimeTypes.PushEndpoint);
    }

    async getPath(nativeId?: string, options?: { public?: boolean; }): Promise<string> {
        return `/endpoint/${this.getEndpoint(nativeId)}/${options?.public ? 'public/' : ''}`
    }

    async getLocalEndpoint(nativeId?: string, options?: { public?: boolean; insecure?: boolean; }): Promise<string> {
        const protocol = options?.insecure ? 'http' : 'https';
        const port = await this.api.getComponent(options?.insecure ? 'SCRYPTED_INSECURE_PORT' : 'SCRYPTED_SECURE_PORT');
        const path = await this.getPath(nativeId, options);
        const url = `${protocol}://${await this.getUrlSafeIp()}:${port}${path}`;
        return url;
    }

    async getCloudEndpoint(nativeId?: string, options?: { public?: boolean; }): Promise<string> {
        const local = await this.getLocalEndpoint(nativeId, options);
        const mo = await this.mediaManager.createMediaObject(Buffer.from(local), ScryptedMimeTypes.LocalUrl);
        return this.mediaManager.convertMediaObjectToUrl(mo, ScryptedMimeTypes.LocalUrl);
    }

    async getCloudPushEndpoint(nativeId?: string): Promise<string> {
        const mo = await this.mediaManager.createMediaObject(Buffer.from(this.getEndpoint(nativeId)), ScryptedMimeTypes.PushEndpoint);
        return this.mediaManager.convertMediaObjectToUrl(mo, ScryptedMimeTypes.PushEndpoint);
    }

    async setLocalAddresses(addresses: string[]): Promise<void> {
        const addressSettings = await this.api.getComponent('addresses');
        return addressSettings.setLocalAddresses(addresses);
    }

    async getLocalAddresses(): Promise<string[]> {
        const addressSettings = await this.api.getComponent('addresses');
        return await addressSettings.getLocalAddresses() as string[];
    }

    async setAccessControlAllowOrigin(options: EndpointAccessControlAllowOrigin): Promise<void> {
        const self = this;
        const setAccessControlAllowOrigin = await this.deviceManager.systemManager.getComponent('setAccessControlAllowOrigin') as typeof self.setAccessControlAllowOrigin;
        return setAccessControlAllowOrigin(options);
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
        this.deviceManager.systemManager.state[this.id][p as string] = {
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
        public getDeviceConsole: (nativeId?: ScryptedNativeId) => Console,
        public getMixinConsole: (mixinId: string, nativeId?: ScryptedNativeId) => Console) {
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

    createDeviceState(id: string, setState: (property: string, value: any) => Promise<void>): WritableDeviceState {
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

function toStorageString(value: any) {
    if (value === null)
        return 'null';
    if (value === undefined)
        return 'undefined';

    return value.toString();
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
            const keyString = property.toString();
            if (StorageImpl.allowedMethods.includes(keyString)) {
                const f = target[keyString];
                if (keyString === 'length')
                    return f;
                return f.bind(target);
            }
            return target.getItem(toStorageString(property));
        },
        set(target, property, value): boolean {
            target.setItem(toStorageString(property), value);
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
        key = toStorageString(key);
        value = toStorageString(value);
        if (this.storage[this.prefix + key] === value)
            return;
        this.storage[this.prefix + key] = value;
        this.api.setStorage(this.nativeId, this.storage);
    }
}

export async function setupPluginRemote(peer: RpcPeer, api: PluginAPI, pluginId: string, hostInfo: PluginHostInfo, getSystemState: () => { [id: string]: { [property: string]: SystemDeviceState } }): Promise<PluginRemote> {
    try {
        // the host/remote connection can be from server to plugin (node to node),
        // core plugin to web (node to browser).
        // always add the BufferSerializer, so serialization is gauranteed to work.
        // but in plugin-host, mark Buffer as transport safe.
        if (!peer.constructorSerializerMap.get(Buffer))
            peer.addSerializer(Buffer, 'Buffer', new BufferSerializer());
        const getRemote = await peer.getParam('getRemote');
        const remote = await getRemote(api, pluginId, hostInfo) as PluginRemote;

        const accessControls: AccessControls = peer.tags.acl;

        const getAccessControlDeviceState = (id: string, state?: { [property: string]: SystemDeviceState }) => {
            state = state || getSystemState()[id];
            if (accessControls && state) {
                state = Object.assign({}, state);
                for (const property of Object.keys(state)) {
                    if (accessControls.shouldRejectProperty(id, property))
                        delete state[property];
                }
                let interfaces: ScryptedInterface[] = state.interfaces?.value;
                if (interfaces) {
                    interfaces = interfaces.filter(scryptedInterface => !accessControls.shouldRejectInterface(id, scryptedInterface));
                    state.interfaces = {
                        value: interfaces,
                    }
                }
            }
            return state;
        }

        const getAccessControlSystemState = () => {
            let state = getSystemState();
            if (accessControls) {
                state = Object.assign({}, state);
                for (const id of Object.keys(state)) {
                    if (accessControls.shouldRejectDevice(id)) {
                        delete state[id];
                        continue;
                    }
                    state[id] = getAccessControlDeviceState(id, state[id]);
                }
            }

            return state;
        }

        await remote.setSystemState(getAccessControlSystemState());
        api.listen((id, eventDetails, eventData) => {
            if (accessControls?.shouldRejectEvent(eventDetails.property === ScryptedInterfaceProperty.id ? eventData : id, eventDetails))
                return;

            // ScryptedDevice events will be handled specially and repropagated by the remote.
            if (eventDetails.eventInterface === ScryptedInterface.ScryptedDevice) {
                if (eventDetails.property === ScryptedInterfaceProperty.id) {
                    // a change on the id property means device was deleted
                    remote.updateDeviceState(eventData, undefined);
                }
                else {
                    // a change on anything else is a descriptor update
                    remote.updateDeviceState(id, getAccessControlDeviceState(id));
                }
                return;
            }

            if (eventDetails.property && !eventDetails.mixinId) {
                remote.notify(id, eventDetails, getSystemState()[id]?.[eventDetails.property]).catch(() => { });
            }
            else {
                remote.notify(id, eventDetails, eventData).catch(() => { });
            }
        });

        return remote;
    }
    catch (e) {
        throw new RPCResultError(peer, 'error while retrieving PluginRemote', e as Error);
    }
}

export interface WebSocketCustomHandler {
    id: string,
    methods: WebSocketMethods;
}

export interface PluginRemoteAttachOptions {
    createMediaManager?: (systemManager: SystemManager, deviceManager: DeviceManagerImpl) => Promise<MediaManager>;
    getServicePort?: (name: string, ...args: any[]) => Promise<number>;
    getDeviceConsole?: (nativeId?: ScryptedNativeId) => Console;
    getPluginConsole?: () => Console;
    getMixinConsole?: (id: string, nativeId?: ScryptedNativeId) => Console;
    onLoadZip?: (scrypted: ScryptedStatic, params: any, packageJson: any, getZip: () => Promise<Buffer>, zipOptions: PluginRemoteLoadZipOptions) => Promise<any>;
    onGetRemote?: (api: PluginAPI, pluginId: string) => Promise<PluginAPI>;
}

export function attachPluginRemote(peer: RpcPeer, options?: PluginRemoteAttachOptions): Promise<ScryptedStatic> {
    const { createMediaManager, getServicePort, getDeviceConsole, getMixinConsole } = options || {};

    if (!peer.constructorSerializerMap.get(Buffer))
        peer.addSerializer(Buffer, 'Buffer', new BufferSerializer());

    const ioSockets: { [id: string]: WebSocketConnectCallbacks } = {};
    const websocketSerializer = new WebSocketSerializer();
    peer.addSerializer(WebSocketConnection, 'WebSocketConnection', websocketSerializer);

    let done: (scrypted: ScryptedStatic) => void;
    const retPromise = new Promise<ScryptedStatic>(resolve => done = resolve);

    peer.params.getRemote = async (api: PluginAPI, pluginId: string, hostInfo: PluginHostInfo) => {
        websocketSerializer.WebSocket = createWebSocketClass((connection, callbacks) => {
            const { url } = connection;
            if (url.startsWith('io://') || url.startsWith('ws://')) {
                const id = url.substring('xx://'.length);

                ioSockets[id] = callbacks;

                callbacks.connect(undefined, {
                    close: (message) => connection.close(message),
                    send: (message) => connection.send(message),
                });
            }
            else {
                throw new Error('unsupported websocket');
            }
        });

        api = await options?.onGetRemote?.(api, pluginId) || api;

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
            serverVersion: hostInfo?.serverVersion,
            connect: undefined,
            fork: undefined,
            connectRPCObject: undefined,
        };

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
                    systemManager.events.notify(undefined, undefined, ScryptedInterface.ScryptedDevice, ScryptedInterfaceProperty.id, id, { changed: true });
                }
                else {
                    systemManager.state[id] = state;
                    systemManager.events.notify(id, undefined, ScryptedInterface.ScryptedDevice, undefined, state, { changed: true });
                }
            },

            async notify(id: string, eventTimeOrDetails: number | EventDetails, eventInterfaceOrData: string | SystemDeviceState | any, property?: string, value?: SystemDeviceState | any, changed?: boolean) {
                if (typeof eventTimeOrDetails === 'number') {
                    // TODO: remove legacy code path
                    // 12/30/2022
                    const eventTime = eventTimeOrDetails as number;
                    const eventInterface = eventInterfaceOrData as string;
                    if (property) {
                        const state = systemManager.state?.[id];
                        if (!state) {
                            log.w(`state not found for ${id}`);
                            return;
                        }
                        state[property] = value;
                        systemManager.events.notify(id, eventTime, eventInterface, property, value.value, { changed });
                    }
                    else {
                        systemManager.events.notify(id, eventTime, eventInterface, property, value, { changed });
                    }
                }
                else {
                    const eventDetails = eventTimeOrDetails as EventDetails;
                    const eventData = eventInterfaceOrData as any;
                    if (eventDetails.property && !eventDetails.mixinId) {
                        const state = systemManager.state?.[id];
                        if (!state) {
                            log.w(`state not found for ${id}`);
                            return;
                        }
                        state[eventDetails.property] = eventData;
                        systemManager.events.notifyEventDetails(id, eventDetails, eventData.value);
                    }
                    else {
                        systemManager.events.notifyEventDetails(id, eventDetails, eventData);
                    }
                }
            },

            async setSystemState(state: { [id: string]: { [property: string]: SystemDeviceState } }) {
                systemManager.state = state;
                deviceManager.pruneMixinStorage();
                done(ret);
            },

            async loadZip(packageJson: any, getZip: () => Promise<Buffer>, zipOptions?: PluginRemoteLoadZipOptions) {
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

                try {
                    return await options.onLoadZip(ret, params, packageJson, getZip, zipOptions);
                }
                catch (e) {
                    console.error('plugin start/fork failed', e)
                    throw e;
                }
            },
        }

        ret.pluginRemoteAPI = remote;

        return remote;
    }

    return retPromise;
}
