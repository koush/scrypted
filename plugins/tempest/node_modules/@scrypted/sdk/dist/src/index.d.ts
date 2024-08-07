export * from '../types/gen/index';
import type { DeviceState, EventListenerRegister, Logger, MediaObject, ScryptedInterface, ScryptedNativeId, ScryptedStatic } from '../types/gen/index';
import { DeviceBase } from '../types/gen/index';
/**
 * @category Core Reference
 */
export declare class ScryptedDeviceBase extends DeviceBase {
    readonly nativeId?: string;
    private _storage;
    private _log;
    private _console;
    private _deviceState;
    constructor(nativeId?: string);
    get storage(): Storage;
    get log(): Logger;
    get console(): Console;
    createMediaObject(data: any, mimeType: string): Promise<MediaObject & {
        sourceId: string;
    }>;
    getMediaObjectConsole(mediaObject: MediaObject): Console;
    _lazyLoadDeviceState(): void;
    /**
     * Fire an event for this device.
     */
    onDeviceEvent(eventInterface: string, eventData: any): Promise<void>;
}
/**
 * @category Mixin Reference
 */
export interface MixinDeviceOptions<T> {
    mixinDevice: T;
    mixinProviderNativeId: ScryptedNativeId;
    mixinDeviceInterfaces: ScryptedInterface[];
    mixinStorageSuffix?: string;
    mixinDeviceState: DeviceState;
}
/**
 * @category Mixin Reference
 */
export declare class MixinDeviceBase<T> extends DeviceBase implements DeviceState {
    mixinProviderNativeId: ScryptedNativeId;
    mixinDevice: T;
    mixinDeviceInterfaces: ScryptedInterface[];
    private _storage;
    private mixinStorageSuffix;
    private _log;
    private _console;
    private _deviceState;
    private _listeners;
    constructor(options: MixinDeviceOptions<T>);
    get storage(): Storage;
    get console(): Console;
    createMediaObject(data: any, mimeType: string): Promise<MediaObject & {
        sourceId: string;
    }>;
    getMediaObjectConsole(mediaObject: MediaObject): Console;
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
