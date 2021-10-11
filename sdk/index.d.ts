export * from './types';
import type { ScryptedNativeId } from './types';
import type { DeviceInformation, ScryptedInterface, ScryptedStatic, ScryptedDeviceType, Logger, ColorRgb, ColorHsv, DeviceState, TemperatureUnit, LockState, ThermostatMode, Position } from './types';
export declare class ScryptedDeviceBase implements DeviceState {
    nativeId?: string;
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
    /**
     * Get the ambient temperature in Celsius.
     */
    temperature?: number;
    /**
     * Get the user facing unit of measurement for this thermometer. Note that while this may be Fahrenheit, getTemperatureAmbient will return the temperature in Celsius.
     */
    temperatureUnit?: TemperatureUnit;
    humidity?: number;
    thermostatAvailableModes?: ThermostatMode[];
    thermostatMode?: ThermostatMode;
    thermostatSetpoint?: number;
    thermostatSetpointHigh?: number;
    thermostatSetpointLow?: number;
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
export declare class MixinDeviceBase<T> implements DeviceState {
    mixinDevice: T;
    mixinDeviceInterfaces: ScryptedInterface[];
    mixinProviderNativeId: ScryptedNativeId;
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
    /**
     * Get the ambient temperature in Celsius.
     */
    temperature?: number;
    /**
     * Get the user facing unit of measurement for this thermometer. Note that while this may be Fahrenheit, getTemperatureAmbient will return the temperature in Celsius.
     */
    temperatureUnit?: TemperatureUnit;
    humidity?: number;
    thermostatAvailableModes?: ThermostatMode[];
    thermostatMode?: ThermostatMode;
    thermostatSetpoint?: number;
    thermostatSetpointHigh?: number;
    thermostatSetpointLow?: number;
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
    private _storage;
    private _log;
    private _console;
    private _deviceState;
    constructor(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: DeviceState, mixinProviderNativeId: ScryptedNativeId);
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
