export * from './types'
import { ScryptedInterfaceProperty } from './types';
import type { ScryptedNativeId, DeviceManager, SystemManager, MediaManager, EndpointManager } from './types';
import type { DeviceInformation, ScryptedInterface, ScryptedStatic, ScryptedDeviceType, Logger, ColorRgb, ColorHsv, DeviceState, TemperatureUnit, LockState, ThermostatMode, Position, ScryptedDevice } from './types';

export class ScryptedDeviceBase implements DeviceState {
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
  thermostatActiveMode?: ThermostatMode;
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


  private _storage: Storage;
  private _log: Logger;
  private _console: Console;
  private _deviceState: DeviceState;

  constructor(public nativeId?: string) {
  }

  get storage() {
    if (!this._storage) {
      this._storage = deviceManager.getDeviceStorage(this.nativeId);
    }
    return this._storage;
  }

  /** 
   * @deprecated
   */
  get log() {
    if (!this._log) {
      this._log = deviceManager.getDeviceLogger(this.nativeId);
    }
    return this._log;
  }

  get console() {
    if (!this._console) {
      this._console = deviceManager.getDeviceConsole(this.nativeId);
    }

    return this._console;
  }

  _lazyLoadDeviceState() {
    if (!this._deviceState) {
      if (this.nativeId) {
        this._deviceState = deviceManager.getDeviceState(this.nativeId);
      }
      else {
        this._deviceState = deviceManager.getDeviceState();
      }
    }
  }

  /**
   * Fire an event for this device.
   */
  onDeviceEvent(eventInterface: string, eventData: any): Promise<void> {
    return deviceManager.onDeviceEvent(this.nativeId, eventInterface, eventData);
  }
}


export class MixinDeviceBase<T> implements DeviceState {
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

  private _storage: Storage;
  private _log: Logger;
  private _console: Console;
  private _deviceState: DeviceState;

  constructor(public mixinDevice: T, public mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: DeviceState, public mixinProviderNativeId: ScryptedNativeId) {
    this._deviceState = mixinDeviceState;
  }


  get storage() {
    if (!this._storage) {
      this._storage = deviceManager.getMixinStorage(this.id, this.mixinProviderNativeId);
    }
    return this._storage;
  }

  get console() {
    if (!this._console) {
      if (deviceManager.getMixinConsole)
        this._console = deviceManager.getMixinConsole(this.id, this.mixinProviderNativeId);
      else
        this._console = deviceManager.getDeviceConsole(this.mixinProviderNativeId);
    }

    return this._console;
  }

  /**
   * Fire an event for this device.
   */
   onDeviceEvent(eventInterface: string, eventData: any): Promise<void> {
    return deviceManager.onMixinEvent(this.id, this.mixinProviderNativeId, eventInterface, eventData);
  }

  _lazyLoadDeviceState() {
  }

  release() {
  }
}


(function () {
  function _createGetState(state: any) {
    return function () {
      this._lazyLoadDeviceState();
      return this._deviceState[state];
    };
  }

  function _createSetState(state: any) {
    return function (value: any) {
      this._lazyLoadDeviceState();
      this._deviceState[state] = value;
    };
  }

  for (var field of Object.values(ScryptedInterfaceProperty)) {
    Object.defineProperty(ScryptedDeviceBase.prototype, field, {
      set: _createSetState(field),
      get: _createGetState(field),
    });
    Object.defineProperty(MixinDeviceBase.prototype, field, {
      set: _createSetState(field),
      get: _createGetState(field),
    });
  }
})();


let sdk: ScryptedStatic = {} as any;
declare const deviceManager: DeviceManager;
declare const endpointManager: EndpointManager;
declare const mediaManager: MediaManager;
declare const systemManager: SystemManager;
declare const pluginHostAPI: any;

try {
  sdk = Object.assign(sdk, {
    log: deviceManager.getDeviceLogger(undefined),
    deviceManager,
    endpointManager,
    mediaManager,
    systemManager,
    pluginHostAPI,
  });
}
catch (e) {
  console.error('sdk initialization error, import @scrypted/sdk/types instead', e);
}

export default sdk;
