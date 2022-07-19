export * from './types/index'
import { ScryptedInterfaceProperty, DeviceBase, MediaObject, ScryptedInterfaceDescriptors, TYPES_VERSION } from './types/index';
import type { ScryptedNativeId, DeviceManager, SystemManager, MediaManager, EndpointManager, EventListenerRegister } from './types/index';
import type { ScryptedInterface, ScryptedStatic, Logger, DeviceState } from './types/index';

export class ScryptedDeviceBase extends DeviceBase {
  private _storage: Storage;
  private _log: Logger;
  private _console: Console;
  private _deviceState: DeviceState;

  constructor(public nativeId?: string) {
    super();
  }

  get storage() {
    if (!this._storage) {
      this._storage = deviceManager.getDeviceStorage(this.nativeId);
    }
    return this._storage;
  }

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

  async createMediaObject(data: any, mimeType: string) {
    return mediaManager.createMediaObject(data, mimeType, {
      sourceId: this.id,
    });
  }

  getMediaObjectConsole(mediaObject: MediaObject): Console {
    if (typeof mediaObject.sourceId !== 'string')
      return this.console;
    return deviceManager.getMixinConsole(mediaObject.sourceId, this.nativeId);
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

export interface MixinDeviceOptions<T> {
  mixinDevice: T;
  mixinProviderNativeId: ScryptedNativeId;
  mixinDeviceInterfaces: ScryptedInterface[];
  mixinStorageSuffix?: string;
  mixinDeviceState: DeviceState;
}

export class MixinDeviceBase<T> extends DeviceBase implements DeviceState {
  mixinProviderNativeId: ScryptedNativeId;
  mixinDevice: T;
  mixinDeviceInterfaces: ScryptedInterface[];
  private _storage: Storage;
  private mixinStorageSuffix: string;
  private _log: Logger;
  private _console: Console;
  private _deviceState: DeviceState;
  private _listeners = new Set<EventListenerRegister>();

  constructor(options: MixinDeviceOptions<T>) {
    super();
    this.mixinDevice = options.mixinDevice;
    this.mixinDeviceInterfaces = options.mixinDeviceInterfaces;
    this.mixinStorageSuffix = options.mixinStorageSuffix;
    this._deviceState = options.mixinDeviceState;
    this.mixinProviderNativeId = options.mixinProviderNativeId;
  }

  get storage() {
    if (!this._storage) {
      const mixinStorageSuffix = this.mixinStorageSuffix;
      const mixinStorageKey = this.id + (mixinStorageSuffix ? ':' + mixinStorageSuffix : '');
      this._storage = deviceManager.getMixinStorage(mixinStorageKey, this.mixinProviderNativeId);
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

  async createMediaObject(data: any, mimeType: string) {
    return mediaManager.createMediaObject(data, mimeType, {
      sourceId: this.id,
    });
  }

  getMediaObjectConsole(mediaObject: MediaObject): Console {
    if (typeof mediaObject.sourceId !== 'string')
      return this.console;
    return deviceManager.getMixinConsole(mediaObject.sourceId, this.mixinProviderNativeId);
  }

  /**
   * Fire an event for this device.
   */
   onDeviceEvent(eventInterface: string, eventData: any): Promise<void> {
    return deviceManager.onMixinEvent(this.id, this, eventInterface, eventData);
  }

  _lazyLoadDeviceState() {
  }

  manageListener(listener: EventListenerRegister) {
    this._listeners.add(listener);
  }

  release() {
    for (const l of this._listeners) {
      l.removeListener();
    }
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
declare const pluginRuntimeAPI: any;

try {
  let runtimeAPI: any;
  try {
    runtimeAPI = pluginRuntimeAPI;
  }
  catch (e) {
  }

  sdk = Object.assign(sdk, {
    log: deviceManager.getDeviceLogger(undefined),
    deviceManager,
    endpointManager,
    mediaManager,
    systemManager,
    pluginHostAPI,
    ...runtimeAPI,
  }); 

  try {
    (systemManager as any).setScryptedInterfaceDescriptors?.(TYPES_VERSION, ScryptedInterfaceDescriptors)?.catch(() => {});
  }
  catch (e) {
  }
}
catch (e) {
  console.error('sdk initialization error, import @scrypted/types or use @scrypted/web-sdk instead', e);
}

export default sdk;
