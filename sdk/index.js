"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var _a, _b, _c;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MixinDeviceBase = exports.ScryptedDeviceBase = void 0;
__exportStar(require("./types/index"), exports);
const index_1 = require("./types/index");
class ScryptedDeviceBase extends index_1.DeviceBase {
    constructor(nativeId) {
        super();
        this.nativeId = nativeId;
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
    async createMediaObject(data, mimeType) {
        return mediaManager.createMediaObject(data, mimeType, {
            sourceId: this.id,
        });
    }
    getMediaObjectConsole(mediaObject) {
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
    onDeviceEvent(eventInterface, eventData) {
        return deviceManager.onDeviceEvent(this.nativeId, eventInterface, eventData);
    }
}
exports.ScryptedDeviceBase = ScryptedDeviceBase;
class MixinDeviceBase extends index_1.DeviceBase {
    constructor(options) {
        super();
        this._listeners = new Set();
        this.mixinDevice = options.mixinDevice;
        this.mixinDeviceInterfaces = options.mixinDeviceInterfaces;
        this.mixinStorageSuffix = options.mixinStorageSuffix;
        this._deviceState = options.mixinDeviceState;
        // 8-11-2022
        // RpcProxy will trap all properties, and the following check/hack will determine
        // if the device state came from another node worker thread.
        // This should ultimately be removed at some point in the future.
        if (this._deviceState.__rpcproxy_traps_all_properties && deviceManager.createDeviceState && typeof this._deviceState.id === 'string') {
            this._deviceState = deviceManager.createDeviceState(this._deviceState.id, this._deviceState.setState);
        }
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
    async createMediaObject(data, mimeType) {
        return mediaManager.createMediaObject(data, mimeType, {
            sourceId: this.id,
        });
    }
    getMediaObjectConsole(mediaObject) {
        if (typeof mediaObject.sourceId !== 'string')
            return this.console;
        return deviceManager.getMixinConsole(mediaObject.sourceId, this.mixinProviderNativeId);
    }
    /**
     * Fire an event for this device.
     */
    onDeviceEvent(eventInterface, eventData) {
        return deviceManager.onMixinEvent(this.id, this, eventInterface, eventData);
    }
    _lazyLoadDeviceState() {
    }
    manageListener(listener) {
        this._listeners.add(listener);
    }
    release() {
        for (const l of this._listeners) {
            l.removeListener();
        }
    }
}
exports.MixinDeviceBase = MixinDeviceBase;
(function () {
    function _createGetState(state) {
        return function () {
            var _a;
            this._lazyLoadDeviceState();
            return (_a = this._deviceState) === null || _a === void 0 ? void 0 : _a[state];
        };
    }
    function _createSetState(state) {
        return function (value) {
            this._lazyLoadDeviceState();
            if (!this._deviceState)
                console.warn('device state is unavailable. the device must be discovered with deviceManager.onDeviceDiscovered or deviceManager.onDevicesChanged before the state can be set.');
            else
                this._deviceState[state] = value;
        };
    }
    for (var field of Object.values(index_1.ScryptedInterfaceProperty)) {
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
let sdk = {};
try {
    let runtimeAPI;
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
        (_c = (_b = (_a = systemManager).setScryptedInterfaceDescriptors) === null || _b === void 0 ? void 0 : _b.call(_a, index_1.TYPES_VERSION, index_1.ScryptedInterfaceDescriptors)) === null || _c === void 0 ? void 0 : _c.catch(() => { });
    }
    catch (e) {
    }
}
catch (e) {
    console.error('sdk initialization error, import @scrypted/types or use @scrypted/client instead', e);
}
exports.default = sdk;
//# sourceMappingURL=index.js.map