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
    constructor(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, mixinProviderNativeId, _mixinStorageSuffix) {
        super();
        this.mixinDevice = mixinDevice;
        this.mixinDeviceInterfaces = mixinDeviceInterfaces;
        this.mixinProviderNativeId = mixinProviderNativeId;
        this._mixinStorageSuffix = _mixinStorageSuffix;
        this._listeners = new Set();
        this._deviceState = mixinDeviceState;
    }
    get storage() {
        if (!this._storage) {
            const mixinStorageSuffix = this._mixinStorageSuffix;
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
            this._lazyLoadDeviceState();
            return this._deviceState[state];
        };
    }
    function _createSetState(state) {
        return function (value) {
            this._lazyLoadDeviceState();
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
    console.error('sdk initialization error, import @scrypted/types or use @scrypted/web-sdk instead', e);
}
exports.default = sdk;
//# sourceMappingURL=index.js.map