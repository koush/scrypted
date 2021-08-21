export * from './types'
import { ScryptedStatic, ScryptedDeviceType, Logger, ColorRgb, ColorHsv, DeviceState, TemperatureUnit, LockState, ThermostatMode, Position  } from './types';

export class ScryptedDeviceBase implements DeviceState {
  constructor(nativeId?: string);
  nativeId: string;
  log: Logger;
  storage: Storage;
  component?: string;
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
  occupied?: boolean;
  flooded?: boolean;
  ultraviolet?: number;
  luminance?: number;
  position?: Position;
}


export class MixinDeviceBase implements DeviceState {
  constructor(mixinDevice: any, deviceState: any);
  mixinDevice: any;
  component?: string;
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
  occupied?: boolean;
  flooded?: boolean;
  ultraviolet?: number;
  luminance?: number;
  position?: Position;
}

declare const Scrypted: ScryptedStatic;

export default Scrypted;
