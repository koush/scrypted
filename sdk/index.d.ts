export * from './types';
import type { ScryptedNativeId } from './types';
import type { HumiditySettingStatus, DeviceInformation, ScryptedInterface, ScryptedStatic, ScryptedDeviceType, Logger, ColorRgb, ColorHsv, DeviceState, TemperatureUnit, LockState, ThermostatMode, Position, FanStatus } from './types';
export declare class DeviceBase {
    id?: string;
    interfaces?: string[];
    mixins?: string[];
    info?: DeviceInformation;
    name?: string;
    providedInterfaces?: string[];
    providedName?: ScryptedDeviceType;
    providedRoom?: string;
    providedType?: ScryptedDeviceType;
    providerId?: string;
    room?: string;
    type?: ScryptedDeviceType;
    on?: boolean;
    brightness?: number;
    colorTemperature?: number;
    rgb?: ColorRgb;
    hsv?: ColorHsv;
    running?: boolean;
    paused?: boolean;
    docked?: boolean;
    temperature?: number;
    temperatureUnit?: TemperatureUnit;
    humidity?: number;
    thermostatAvailableModes?: ThermostatMode[];
    thermostatMode?: ThermostatMode;
    thermostatActiveMode?: ThermostatMode;
    thermostatSetpoint?: number;
    thermostatSetpointHigh?: number;
    thermostatSetpointLow?: number;
    humiditySetting?: HumiditySettingStatus;
    fan?: FanStatus;
    lockState?: LockState;
    entryOpen?: boolean;
    batteryLevel?: number;
    online?: boolean;
    updateAvailable?: boolean;
    fromMimeType?: string;
    toMimeType?: string;
    binaryState?: boolean;
    intrusionDetected?: boolean;
    powerDetected?: boolean;
    motionDetected?: boolean;
    audioDetected?: boolean;
    occupied?: boolean;
    flooded?: boolean;
    ultraviolet?: number;
    luminance?: number;
    position?: Position;
}
export declare class ScryptedDeviceBase extends DeviceBase implements DeviceState {
    nativeId?: string;
    private _storage;
    private _log;
    private _console;
    private _deviceState;
    constructor(nativeId?: string);
    get storage(): Storage;
    /**
     * @deprecated
     */
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
    private _storage;
    private _log;
    private _console;
    private _deviceState;
    constructor(mixinDevice: T, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: DeviceState, mixinProviderNativeId: ScryptedNativeId);
    get storage(): Storage;
    get console(): Console;
    /**
     * Fire an event for this device.
     */
    onDeviceEvent(eventInterface: string, eventData: any): Promise<void>;
    _lazyLoadDeviceState(): void;
    release(): void;
}
declare let sdk: ScryptedStatic;
export default sdk;
