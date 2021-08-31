var sdk = require('./index.generated.js');
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

module.exports = sdk;
module.exports.default = sdk;
