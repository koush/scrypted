export * from '../types/gen/index';
import type { DeviceManager, DeviceState, EndpointManager, EventListenerRegister, Logger, MediaManager, MediaObject, ScryptedInterface, ScryptedNativeId, ScryptedStatic, SystemManager, WritableDeviceState } from '../types/gen/index';
import { DeviceBase, ScryptedInterfaceDescriptors, ScryptedInterfaceProperty, TYPES_VERSION } from '../types/gen/index';

/**
 * @category Core Reference
 */
export class ScryptedDeviceBase extends DeviceBase {
  private _storage: Storage | undefined;
  private _log: Logger | undefined;
  private _console: Console | undefined;
  private _deviceState: DeviceState | undefined;

  constructor(public readonly nativeId?: string) {
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

  getMediaObjectConsole(mediaObject: MediaObject): Console | undefined {
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

/**
 * @category Mixin Reference
 */
export interface MixinDeviceOptions<T> {
  mixinDevice: T;
  mixinProviderNativeId: ScryptedNativeId;
  mixinDeviceInterfaces: ScryptedInterface[];
  mixinStorageSuffix?: string;
  mixinDeviceState: WritableDeviceState;
}

/**
 * @category Mixin Reference
 */
export class MixinDeviceBase<T> extends DeviceBase implements DeviceState {
  mixinProviderNativeId: ScryptedNativeId;
  mixinDevice: T;
  mixinDeviceInterfaces: ScryptedInterface[];
  private _storage: Storage | undefined;
  private mixinStorageSuffix: string | undefined;
  private _log: Logger | undefined;
  private _console: Console | undefined;
  private _deviceState: WritableDeviceState;
  private _listeners = new Set<EventListenerRegister>();

  constructor(options: MixinDeviceOptions<T>) {
    super();

    this.mixinDevice = options.mixinDevice;
    this.mixinDeviceInterfaces = options.mixinDeviceInterfaces;
    this.mixinStorageSuffix = options.mixinStorageSuffix;
    this._deviceState = options.mixinDeviceState;
    this.nativeId = systemManager.getDeviceById(this.id).nativeId;
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
  function _createGetState(state: ScryptedInterfaceProperty) {
    return function () {
      // @ts-ignore: this as any
      this._lazyLoadDeviceState();
      // @ts-ignore: this as any
      return this._deviceState?.[state];
    };
  }

  function _createSetState(state: ScryptedInterfaceProperty) {
    return function (value: any) {
      // @ts-ignore: this as any
      this._lazyLoadDeviceState();
      // @ts-ignore: this as any
      if (!this._deviceState) {
        console.warn('device state is unavailable. the device must be discovered with deviceManager.onDeviceDiscovered or deviceManager.onDevicesChanged before the state can be set.');
      }
      else {
        // @ts-ignore: this as any
        this._deviceState[state] = value;
      }
    };
  }

  for (const field of Object.values(ScryptedInterfaceProperty)) {
    if (field === ScryptedInterfaceProperty.nativeId)
      continue;
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

export const sdk: ScryptedStatic = {} as any;
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

  Object.assign(sdk, {
    log: deviceManager.getDeviceLogger(undefined),
    deviceManager,
    endpointManager,
    mediaManager,
    systemManager,
    pluginHostAPI,
    ...runtimeAPI,
  });

  try {
    (systemManager as any).setScryptedInterfaceDescriptors?.(TYPES_VERSION, ScryptedInterfaceDescriptors)?.catch(() => { });
  }
  catch (e) {
  }
}
catch (e) {
  console.error('sdk initialization error, import @scrypted/types or use @scrypted/client instead', e);
}

export default sdk;
