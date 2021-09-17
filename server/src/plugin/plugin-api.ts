import { ScryptedDevice, Device, DeviceManifest, EventDetails, EventListenerOptions, EventListenerRegister, ScryptedInterfaceProperty, MediaObject, SystemDeviceState, MediaManager, HttpRequest } from '@scrypted/sdk/types'

export interface PluginLogger {
    log(level: string, message: string): Promise<void>;
    clear(): Promise<void>;
    clearAlert(message: string): Promise<void>;
    clearAlerts(): Promise<void>;
}

export interface PluginAPI {
    setState(nativeId: string | undefined, key: string, value: any): Promise<void>;
    onDevicesChanged(deviceManifest: DeviceManifest): Promise<void>;
    onDeviceDiscovered(device: Device): Promise<void>;
    onDeviceEvent(nativeId: string, eventInterface: any, eventData?: any): Promise<void>;
    onMixinEvent(id: string, nativeId: string, eventInterface: any, eventData?: any): Promise<void>;
    onDeviceRemoved(nativeId: string): Promise<void>;
    setStorage(nativeId: string, storage: {[key: string]: any}): Promise<void>;

    getDeviceById(id: string): Promise<ScryptedDevice>;
    setDeviceProperty(id: string, property: ScryptedInterfaceProperty, value: any): Promise<void>;
    removeDevice(id: string): Promise<void>;
    listen(EventListener: (id: string, eventDetails: EventDetails, eventData: any) => void): Promise<EventListenerRegister>;
    listenDevice(id: string, event: string | EventListenerOptions, callback: (eventDetails: EventDetails, eventData: object) => void): Promise<EventListenerRegister>;

    ioClose(id: string): Promise<void>;
    ioSend(id: string, message: string): Promise<void>;

    deliverPush(endpoint: string, request: HttpRequest): Promise<void>;

    getLogger(nativeId: string): Promise<PluginLogger>;

    getComponent(id: string): Promise<any>;

    getMediaManager(): Promise<MediaManager>;

    requestRestart(): Promise<void>;
}

class EventListenerRegisterProxy implements EventListenerRegister {
    removeListener: () => void;

    constructor(public listeners: Set<EventListenerRegister>, removeListener: () => void) {
        this.removeListener = () => {
            listeners.delete(this);
            removeListener();
        };
    }
}

export class PluginAPIManagedListeners {
    listeners = new Set<EventListenerRegister>();

    manageListener(listener: EventListenerRegister): EventListenerRegister {
        this.listeners.add(listener);
        return new EventListenerRegisterProxy(this.listeners, () => {
            this.listeners.delete(listener);
            listener.removeListener();
        });
    }

    removeListeners() {
        for (const l of [...this.listeners]) {
            l.removeListener();
        }
        this.listeners.clear();
    }
}

export class PluginAPIProxy extends PluginAPIManagedListeners implements PluginAPI {
    constructor(public api: PluginAPI, public mediaManager?: MediaManager) {
        super();
    }

    setState(nativeId: string, key: string, value: any): Promise<void> {
        return this.api.setState(nativeId, key, value);
    }
    onDevicesChanged(deviceManifest: DeviceManifest): Promise<void> {
        return this.api.onDevicesChanged(deviceManifest);
    }
    onDeviceDiscovered(device: Device): Promise<void> {
        return this.api.onDeviceDiscovered(device);
    }
    onDeviceEvent(nativeId: string, eventInterface: any, eventData?: any): Promise<void> {
        return this.api.onDeviceEvent(nativeId, eventInterface, eventData);
    }
    onMixinEvent(id: string, nativeId: string, eventInterface: any, eventData?: any): Promise<void> {
        return this.api.onMixinEvent(nativeId, eventInterface, eventData);
    }
    onDeviceRemoved(nativeId: string): Promise<void> {
        return this.api.onDeviceRemoved(nativeId);
    }
    setStorage(nativeId: string, storage: { [key: string]: any; }): Promise<void> {
        return this.api.setStorage(nativeId, storage);
    }
    getDeviceById(id: string): Promise<ScryptedDevice> {
        return this.api.getDeviceById(id);
    }
    setDeviceProperty(id: string, property: ScryptedInterfaceProperty, value: any): Promise<void> {
        return this.api.setDeviceProperty(id, property, value);
    }
    removeDevice(id: string): Promise<void> {
        return this.api.removeDevice(id);
    }
    async listen(EventListener: (id: string, eventDetails: EventDetails, eventData: any) => void): Promise<EventListenerRegister> {
        return this.manageListener(await this.api.listen(EventListener));
    }
    async listenDevice(id: string, event: string | EventListenerOptions, callback: (eventDetails: EventDetails, eventData: object) => void): Promise<EventListenerRegister> {
        return this.manageListener(await this.api.listenDevice(id, event, callback));
    }
    ioClose(id: string): Promise<void> {
        return this.api.ioClose(id);
    }
    ioSend(id: string, message: string): Promise<void> {
        return this.api.ioSend(id, message);
    }
    deliverPush(endpoint: string, request: HttpRequest): Promise<void> {
        return this.api.deliverPush(endpoint, request);
    }
    getLogger(nativeId: string): Promise<PluginLogger> {
        return this.api.getLogger(nativeId);
    }
    getComponent(id: string): Promise<any> {
        return this.api.getComponent(id);
    }
    async getMediaManager(): Promise<MediaManager> {
        return this.mediaManager;
    }

    async requestRestart() {
        return this.api.requestRestart();
    }
}

export interface PluginRemote {
    loadZip(packageJson: any, zipData: Buffer): Promise<any>;
    setSystemState(state: {[id: string]: {[property: string]: SystemDeviceState}}): Promise<void>;
    setNativeId(nativeId: string, id: string, storage: {[key: string]: any}): Promise<void>;
    updateDescriptor(id: string, state: {[property: string]: SystemDeviceState}): Promise<void>;
    notify(id: string, eventTime: number, eventInterface: string, property: string|undefined, value: SystemDeviceState|any, changed?: boolean): Promise<void>;

    ioEvent(id: string, event: string, message?: any): Promise<void>;

    createDeviceState(id: string, setState: (property: string, value: any) => Promise<void>): Promise<any>;

    getServicePort(name: string): Promise<number>;
}

export interface MediaObjectRemote extends MediaObject {
    getData(): Promise<Buffer|string>;
}