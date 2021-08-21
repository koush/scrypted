import { ScryptedDevice, Device, DeviceManifest, EventDetails, EventListenerOptions, EventListenerRegister, ScryptedInterfaceProperty, MediaObject, SystemDeviceState, MediaManager } from '@scrypted/sdk/types'
import { Logger } from '../logger';

export interface PluginAPI {
    setState(nativeId: string | undefined, key: string, value: any): Promise<void>;
    onDevicesChanged(deviceManifest: DeviceManifest): Promise<void>;
    onDeviceDiscovered(device: Device): Promise<void>;
    onDeviceEvent(nativeId: string, eventInterface: any, eventData?: any): Promise<void>;
    onDeviceRemoved(nativeId: string): Promise<void>;
    setStorage(nativeId: string, storage: {[key: string]: any}): Promise<void>;

    getDeviceById(id: string): Promise<ScryptedDevice>;
    setDeviceProperty(id: string, property: ScryptedInterfaceProperty, value: any): Promise<void>;
    removeDevice(id: string): Promise<void>;
    listen(EventListener: (id: string, eventDetails: EventDetails, eventData: any) => void): Promise<EventListenerRegister>;
    listenDevice(id: string, event: string | EventListenerOptions, callback: (eventDetails: EventDetails, eventData: object) => void): Promise<EventListenerRegister>;

    ioClose(id: string): Promise<void>;
    ioSend(id: string, message: string): Promise<void>;

    getLogger(nativeId: string): Promise<Logger>;

    getComponent(id: string): Promise<any>;

    getMediaManager(): Promise<MediaManager>

    kill(): Promise<void>;
}

export interface PluginRemote {
    loadZip(zipData: Buffer): Promise<any>;
    setSystemState(state: {[id: string]: {[property: string]: SystemDeviceState}}): Promise<void>;
    setNativeId(nativeId: string, id: string, storage: {[key: string]: any}): Promise<void>;
    updateDescriptor(id: string, state: {[property: string]: SystemDeviceState}): Promise<void>;
    updateProperty(id: string, eventInterface: string, property: string, propertyState: SystemDeviceState, changed?: boolean): Promise<void>;

    ioEvent(id: string, event: string, message?: any): Promise<void>;

    createDeviceState(id: string, setState: (property: string, value: any) => Promise<void>): Promise<any>;
}

export interface MediaObjectRemote extends MediaObject {
    getData(): Promise<Buffer|string>;
}