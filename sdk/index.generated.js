class ScryptedDeviceBase {
    constructor(nativeId) {
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
}


class MixinDeviceBase {
    constructor(mixinDevice, deviceState) {
        this.mixinDevice = mixinDevice;
        this._deviceState = deviceState;
    }

    _lazyLoadDeviceState() {
    }

    release() {
    }
}

(function() {
function _createGetState(state) {
    return function() {
        this._lazyLoadDeviceState();
        return this._deviceState[state];
    };
}

function _createSetState(state) {
    return function(value) {
        this._lazyLoadDeviceState();
        this._deviceState[state] = value;
    };
}

var fields = ["component","id","interfaces","metadata","name","providedInterfaces","providedName","providedRoom","providedType","providerId","room","type","on","brightness","colorTemperature","rgb","hsv","running","paused","docked","temperature","temperatureUnit","humidity","thermostatAvailableModes","thermostatMode","thermostatSetpoint","thermostatSetpointHigh","thermostatSetpointLow","lockState","entryOpen","batteryLevel","online","updateAvailable","fromMimeType","toMimeType","binaryState","intrusionDetected","powerDetected","motionDetected","occupied","flooded","ultraviolet","luminance","position",
];
for (var field of fields) {
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


const sdk = {
    ScryptedDeviceBase,
    MixinDeviceBase,
}

const types = require('./types.generated.js');
Object.assign(sdk, types);

module.exports = sdk;
module.exports.default = sdk;
