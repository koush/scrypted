var sdk = require('./index.generated.js');
try {
    var mediaManagerProxy;
    try {
        mediaManagerProxy = mediaManager;
    }
    catch (e) {
        var mediaManagerApply = function(target, prop, argumentsList) {
            var copy = [];
            if (argumentsList) {
                for (var i in argumentsList) {
                    copy.push(NativeBuffer.from(argumentsList[i]));
                }
            }
            var ret = mediaManager[prop].apply(mediaManager, copy);
            var p = global['Promise'];
            if (!p || (!prop.startsWith('convert'))) {
                return ret;
            }
            // convert the promise to the globally available Promise.
            return new p((resolve, reject) => {
                // todo: dont use native buffer as a return value
                ret.then(r => NativeBuffer.toBuffer(resolve(r)))
                .catch(e => reject(e));
            });
        };
        
        mediaManagerProxy = new Proxy(function(){}, {
            get: function(target, prop) {
                return function() {
                    return mediaManagerApply(target, prop, arguments)
                }
            },
            apply: mediaManagerApply,
        })
    }

    sdk = Object.assign(sdk, {
        log,
    
        android,
        deviceManager,
        endpointManager,
        mediaManager: mediaManagerProxy,
        systemManager,
    });
}
catch (e) {
    console.error('sdk initialization error, import @scrypted/sdk/types instead', e);
}

module.exports = sdk;
module.exports.default = sdk;
