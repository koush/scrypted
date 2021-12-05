export * from './types'
import { ScryptedInterfaceProperty, DeviceBase } from './types';
import type { ScryptedNativeId, DeviceManager, SystemManager, MediaManager, EndpointManager, EventListenerRegister } from './types';
import type { ScryptedInterface, ScryptedStatic, Logger, DeviceState } from './types';

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


export class MixinDeviceBase<T> extends DeviceBase implements DeviceState {
  private _storage: Storage;
  private _log: Logger;
  private _console: Console;
  private _deviceState: DeviceState;
  private _listeners = new Set<EventListenerRegister>();

  constructor(public mixinDevice: T, public mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: DeviceState, public mixinProviderNativeId: ScryptedNativeId) {
    super();
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
