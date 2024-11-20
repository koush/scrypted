import { Device, DeviceManager, DeviceManifest, DeviceState, Logger, ScryptedNativeId, WritableDeviceState } from '@scrypted/types';
import { RpcPeer } from '../rpc';
import { PluginAPI, PluginLogger } from './plugin-api';
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

export class DeviceStateProxyHandler implements ProxyHandler<any> {
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

export class StorageImpl implements Storage {
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
