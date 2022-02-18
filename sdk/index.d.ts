export * from './types/index';
import { DeviceBase } from './types/index';
import type { ScryptedNativeId, EventListenerRegister } from './types/index';
import type { ScryptedInterface, ScryptedStatic, Logger, DeviceState } from './types/index';
export declare class ScryptedDeviceBase extends DeviceBase {
    nativeId?: string;
    private _storage;
    private _log;
    private _console;
    private _deviceState;
    constructor(nativeId?: string);
    get storage(): Storage;
    get log(): Logger;
    get console(): Console;
    _lazyLoadDeviceState(): void;
    /**
     * Fire an event for this device.
     */
    onDeviceEvent(eventInterface: string, eventData: any): Promise<void>;
}
export declare class MixinDeviceBase<T> extends DeviceBase implements DeviceState {
    mixinDevice: T;
    mixinDeviceInterfaces: ScryptedInterface[];
    mixinProviderNativeId: ScryptedNativeId;
    private _mixinStorageSuffix?;
    private _storage;
    private _log;
    private _console;
    private _deviceState;
    private _listeners;
    constructor(mixinDevice: T, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: DeviceState, mixinProviderNativeId: ScryptedNativeId, _mixinStorageSuffix?: string);
    get storage(): Storage;
    get console(): Console;
    /**
     * Fire an event for this device.
     */
    onDeviceEvent(eventInterface: string, eventData: any): Promise<void>;
    _lazyLoadDeviceState(): void;
    manageListener(listener: EventListenerRegister): void;
    release(): void;
}
declare let sdk: ScryptedStatic;
export default sdk;
