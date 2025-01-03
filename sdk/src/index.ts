export * from '../types/gen/index';
import type { DeviceManager, DeviceState, EndpointManager, EventListenerRegister, Logger, MediaManager, MediaObject, ScryptedInterface, ScryptedNativeId, ScryptedStatic, SystemManager, WritableDeviceState } from '../types/gen/index';
import { DeviceBase, ScryptedInterfaceDescriptors, ScryptedInterfaceProperty, TYPES_VERSION } from '../types/gen/index';
import { createRequire } from 'module';

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
      this._storage = sdk.deviceManager.getDeviceStorage(this.nativeId);
    }
    return this._storage;
  }

  get log() {
    if (!this._log) {
      this._log = sdk.deviceManager.getDeviceLogger(this.nativeId);
    }
    return this._log;
  }

  get console() {
    if (!this._console) {
      this._console = sdk.deviceManager.getDeviceConsole(this.nativeId);
    }

    return this._console;
  }

  async createMediaObject(data: any, mimeType: string) {
    return sdk.mediaManager.createMediaObject(data, mimeType, {
      sourceId: this.id,
    });
  }

  getMediaObjectConsole(mediaObject: MediaObject): Console | undefined {
    if (typeof mediaObject.sourceId !== 'string')
      return this.console;
    return sdk.deviceManager.getMixinConsole(mediaObject.sourceId, this.nativeId);
  }

  _lazyLoadDeviceState() {
    if (!this._deviceState) {
      if (this.nativeId) {
        this._deviceState = sdk.deviceManager.getDeviceState(this.nativeId);
      }
      else {
        this._deviceState = sdk.deviceManager.getDeviceState();
      }
    }
  }

  /**
   * Fire an event for this device.
   */
  onDeviceEvent(eventInterface: string, eventData: any): Promise<void> {
    return sdk.deviceManager.onDeviceEvent(this.nativeId, eventInterface, eventData);
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
    this.nativeId = sdk.systemManager.getDeviceById(this.id).nativeId;
    this.mixinProviderNativeId = options.mixinProviderNativeId;

    // RpcProxy will trap all properties, and the following check/hack will determine
    // if the device state came from another node worker thread.
    // This should ultimately be discouraged and warned at some point in the future.
    if ((this._deviceState as any).__rpcproxy_traps_all_properties && typeof this._deviceState.id === 'string') {
      this._deviceState = sdk.deviceManager.createDeviceState(this._deviceState.id, this._deviceState.setState);
    }
  }

  get storage() {
    if (!this._storage) {
      const mixinStorageSuffix = this.mixinStorageSuffix;
      const mixinStorageKey = this.id + (mixinStorageSuffix ? ':' + mixinStorageSuffix : '');
      this._storage = sdk.deviceManager.getMixinStorage(mixinStorageKey, this.mixinProviderNativeId);
    }
    return this._storage;
  }

  get console() {
    if (!this._console) {
      if (sdk.deviceManager.getMixinConsole)
        this._console = sdk.deviceManager.getMixinConsole(this.id, this.mixinProviderNativeId);
      else
        this._console = sdk.deviceManager.getDeviceConsole(this.mixinProviderNativeId);
    }

    return this._console;
  }

  async createMediaObject(data: any, mimeType: string) {
    return sdk.mediaManager.createMediaObject(data, mimeType, {
      sourceId: this.id,
    });
  }

  getMediaObjectConsole(mediaObject: MediaObject): Console {
    if (typeof mediaObject.sourceId !== 'string')
      return this.console;
    return sdk.deviceManager.getMixinConsole(mediaObject.sourceId, this.mixinProviderNativeId);
  }

  /**
   * Fire an event for this device.
   */
  onDeviceEvent(eventInterface: string, eventData: any): Promise<void> {
    return sdk.deviceManager.onMixinEvent(this.id, this, eventInterface, eventData);
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
    return function <T>(this: ScryptedDeviceBase | MixinDeviceBase<T>) {
      this._lazyLoadDeviceState();
      // @ts-ignore: accessing private property
      return this._deviceState?.[state];
    };
  }

  function _createSetState(state: ScryptedInterfaceProperty) {
    return function <T>(this: ScryptedDeviceBase | MixinDeviceBase<T>, value: any) {
      this._lazyLoadDeviceState();
      // @ts-ignore: accessing private property
      if (!this._deviceState) {
        console.warn('device state is unavailable. the device must be discovered with deviceManager.onDeviceDiscovered or deviceManager.onDevicesChanged before the state can be set.');
      }
      else {
        // @ts-ignore: accessing private property
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

declare const deviceManager: DeviceManager;
declare const endpointManager: EndpointManager;
declare const mediaManager: MediaManager;
declare const systemManager: SystemManager;
declare const pluginHostAPI: any;
declare const pluginRuntimeAPI: any;
export const sdk: ScryptedStatic = {} as any;

try {
  let loaded = false;
  try {
    // todo: remove usage of process.env.SCRYPTED_SDK_MODULE, only existed in prerelease builds.
    // import.meta is not a reliable way to detect es module support in webpack since webpack
    // evaluates that to true at runtime.
    const esModule = process.env.SCRYPTED_SDK_ES_MODULE || process.env.SCRYPTED_SDK_MODULE;
    const cjsModule = process.env.SCRYPTED_SDK_CJS_MODULE || process.env.SCRYPTED_SDK_MODULE;
    // @ts-expect-error
    if (esModule && typeof import.meta !== 'undefined') {
      // @ts-expect-error
      const require = createRequire(import.meta.url);
      const sdkModule = require(esModule);
      Object.assign(sdk, sdkModule.getScryptedStatic());
      loaded = true;
    }
    else if (cjsModule) {
      // @ts-expect-error
      if (typeof __non_webpack_require__ !== 'undefined') {
        // @ts-expect-error
        const sdkModule = __non_webpack_require__(process.env.SCRYPTED_SDK_MODULE);
        Object.assign(sdk, sdkModule.getScryptedStatic());
        loaded = true;
      }
      else {
        const sdkModule = require(cjsModule);
        Object.assign(sdk, sdkModule.getScryptedStatic());
        loaded = true;
      }
    }
  }
  catch (e) {
    console.warn("failed to load sdk module", e);
    throw e;
  }

  if (!loaded) {
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
  }

  try {
    (sdk.systemManager as any).setScryptedInterfaceDescriptors?.(TYPES_VERSION, ScryptedInterfaceDescriptors)?.catch(() => { });
  }
  catch (e) {
  }
}
catch (e) {
  console.error('sdk initialization error, import @scrypted/types or use @scrypted/client instead', e);
}

export default sdk;

