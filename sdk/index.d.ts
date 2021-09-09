export * from './types'
import { ScryptedInterface, ScryptedStatic, ScryptedDeviceType, Logger, ColorRgb, ColorHsv, DeviceState, TemperatureUnit, LockState, ThermostatMode, Position, ScryptedDevice  } from './types';

export class ScryptedDeviceBase implements DeviceState {
  constructor(nativeId?: string);
  nativeId: string;
  /**
   * @deprecated
   */
  log: Logger;
  console: Console;
  storage: Storage;
  id?: string;
  interfaces?: string[];
  mixins?: string[];
  metadata?: any;
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
}


export class MixinDeviceBase<T> implements DeviceState {
  constructor(mixinDevice: T, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, providerNativeId: string);
  mixinDevice: ScryptedDevice & T;
  mixinDeviceInterfaces: ScryptedInterface[];
  console: Console;
  storage: Storage;
  id?: string;
  interfaces?: string[];
  metadata?: any;
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

  /**
   * Called when the mixin has been removed or invalidated.
   */
  release(): void;
}

declare const Scrypted: ScryptedStatic;

export default Scrypted;
