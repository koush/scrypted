import type { Device, DeviceManifest, EventDetails, EventListenerOptions, EventListenerRegister, MediaManager, MediaObject, ScryptedDevice, ScryptedInterfaceDescriptor, ScryptedInterfaceProperty, ScryptedNativeId, SystemDeviceState } from '@scrypted/types';
import type { AccessControls } from './acl';

export interface PluginLogger {
    log(level: string, message: string): Promise<void>;
    clear(): Promise<void>;
    clearAlert(message: string): Promise<void>;
    clearAlerts(): Promise<void>;
}

export interface PluginHostInfo {
    serverVersion: string;
}

export interface PluginAPI {
    setState(nativeId: ScryptedNativeId, key: string, value: any): Promise<void>;
    onDevicesChanged(deviceManifest: DeviceManifest): Promise<void>;
    onDeviceDiscovered(device: Device): Promise<string>;
    onDeviceEvent(nativeId: ScryptedNativeId, eventInterface: string, eventData?: any): Promise<void>;
    onMixinEvent(id: string, nativeId: ScryptedNativeId, eventInterface: string, eventData?: any): Promise<void>;
    onDeviceRemoved(nativeId: string): Promise<void>;
    setStorage(nativeId: string, storage: { [key: string]: any }): Promise<void>;

    getDeviceById(id: string): Promise<ScryptedDevice>;
    setDeviceProperty(id: string, property: ScryptedInterfaceProperty, value: any): Promise<void>;
    removeDevice(id: string): Promise<void>;
    listen(EventListener: (id: string, eventDetails: EventDetails, eventData: any) => void): Promise<EventListenerRegister>;
    listenDevice(id: string, event: string | EventListenerOptions, callback: (eventDetails: EventDetails, eventData: any) => void): Promise<EventListenerRegister>;

    getLogger(nativeId: ScryptedNativeId): Promise<PluginLogger>;

    getComponent(id: string): Promise<any>;

    getMediaManager(): Promise<MediaManager>;

    requestRestart(): Promise<void>;

    setScryptedInterfaceDescriptors(typesVersion: string, descriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor }): Promise<void>;
}

class EventListenerRegisterProxy implements EventListenerRegister {
    __proxy_oneway_methods = [
        'removeListener',
    ];

    removeListener() {
        this.listeners.delete(this);
        this.listener.removeListener();
    }

    constructor(public listener: EventListenerRegister, public listeners: Set<EventListenerRegister>) {
        this.listeners.add(this);
    }
}

export class PluginAPIManagedListeners {
    listeners = new Set<EventListenerRegister>();

    manageListener(listener: EventListenerRegister): EventListenerRegister {
        return new EventListenerRegisterProxy(listener, this.listeners);
    }

    removeListeners() {
        for (const l of [...this.listeners]) {
            l.removeListener();
        }
        this.listeners.clear();
    }
}

export class PluginAPIProxy extends PluginAPIManagedListeners implements PluginAPI {
    acl: AccessControls;

    constructor(public api: PluginAPI, public mediaManager?: MediaManager) {
        super();
    }

    setScryptedInterfaceDescriptors(typesVersion: string, descriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor }): Promise<void> {
        this.acl?.deny();
        return this.api.setScryptedInterfaceDescriptors(typesVersion, descriptors);
    }

    setState(nativeId: ScryptedNativeId, key: string, value: any): Promise<void> {
        this.acl?.deny();
        return this.api.setState(nativeId, key, value);
    }
    onDevicesChanged(deviceManifest: DeviceManifest): Promise<void> {
        this.acl?.deny();
        return this.api.onDevicesChanged(deviceManifest);
    }
    onDeviceDiscovered(device: Device): Promise<string> {
        this.acl?.deny();
        return this.api.onDeviceDiscovered(device);
    }
    onDeviceEvent(nativeId: ScryptedNativeId, eventInterface: any, eventData?: any): Promise<void> {
        this.acl?.deny();
        return this.api.onDeviceEvent(nativeId, eventInterface, eventData);
    }
    onMixinEvent(id: string, nativeId: ScryptedNativeId, eventInterface: string, eventData?: any): Promise<void> {
        this.acl?.deny();
        return this.api.onMixinEvent(id, nativeId, eventInterface, eventData);
    }
    onDeviceRemoved(nativeId: string): Promise<void> {
        this.acl?.deny();
        return this.api.onDeviceRemoved(nativeId);
    }
    setStorage(nativeId: ScryptedNativeId, storage: { [key: string]: any; }): Promise<void> {
        this.acl?.deny();
        return this.api.setStorage(nativeId, storage);
    }
    getDeviceById(id: string): Promise<ScryptedDevice> {
        if (this.acl?.shouldRejectDevice(id))
            return;
        return this.api.getDeviceById(id);
    }
    setDeviceProperty(id: string, property: ScryptedInterfaceProperty, value: any): Promise<void> {
        this.acl?.deny();
        return this.api.setDeviceProperty(id, property, value);
    }
    removeDevice(id: string): Promise<void> {
        this.acl?.deny();
        return this.api.removeDevice(id);
    }
    async listen(callback: (id: string, eventDetails: EventDetails, eventData: any) => void): Promise<EventListenerRegister> {
        if (!this.acl)
            return this.manageListener(await this.api.listen(callback));

        return this.manageListener(await this.api.listen((id, details, data) => {
            if (!this.acl.shouldRejectEvent(id, details))
                callback(id, details, data);
        }));
    }
    async listenDevice(id: string, event: string | EventListenerOptions, callback: (eventDetails: EventDetails, eventData: any) => void): Promise<EventListenerRegister> {
        if (!this.acl)
            return this.manageListener(await this.api.listenDevice(id, event, callback));

        return this.manageListener(await this.api.listenDevice(id, event, (details, data) => {
            if (!this.acl.shouldRejectEvent(id, details))
                callback(details, data);
        }));
    }
    getLogger(nativeId: ScryptedNativeId): Promise<PluginLogger> {
        this.acl?.deny();
        return this.api.getLogger(nativeId);
    }
    getComponent(id: string): Promise<any> {
        this.acl?.deny();
        return this.api.getComponent(id);
    }
    async getMediaManager(): Promise<MediaManager> {
        return this.mediaManager;
    }

    async requestRestart() {
        this.acl?.deny();
        return this.api.requestRestart();
    }
}

export interface PluginRemoteLoadZipOptions {
    debug?: boolean;
    zipHash: string;
    fork?: boolean;
    main?: string;

    clusterId: string;
    clusterWorkerId: string;
    clusterSecret: string;
}

export class PluginZipAPI {
    constructor(
        public getZip: () => Promise<Buffer>
    ) {
    }
}

export interface PluginRemote {
    loadZip(packageJson: any, zipAPI: PluginZipAPI, options: PluginRemoteLoadZipOptions): Promise<any>;
    setSystemState(state: { [id: string]: { [property: string]: SystemDeviceState } }): Promise<void>;
    setNativeId(nativeId: ScryptedNativeId, id: string, storage: { [key: string]: any }): Promise<void>;
    updateDeviceState(id: string, state: { [property: string]: SystemDeviceState }): Promise<void>;
    /**
     * @deprecated
     */
    notify(id: string, eventTime: number, eventInterface: string, property: string | undefined, value: SystemDeviceState | any, changed?: boolean): Promise<void>;
    notify(id: string, eventDetails: EventDetails, eventData: SystemDeviceState | any): Promise<void>;

    ioEvent(id: string, event: string, message?: any): Promise<void>;

    createDeviceState(id: string, setState: (property: string, value: any) => Promise<any>): Promise<any>;

    getServicePort(name: string, ...args: any[]): Promise<[number, string]>;
}

export interface MediaObjectRemote extends MediaObject {
    getData(): Promise<Buffer | string>;
}
