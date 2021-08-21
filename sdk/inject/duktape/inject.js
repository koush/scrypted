global.crypto = {
    getRandomValues: function (buf) {
        log.i(buf.constructor.name);
        __getRandomValues(NativeBuffer.from(buf));
    },
    subtle: {
        digest: function(algorithm, data) {
            return __cryptoSubtleDigest(algorithm.name, data);
        }
    }
};

global.location = {
    protocol: 'scrypted:',
};

// duktape does this incorrectly
Date.prototype.toUTCString = function () {
    return __toUTCString(this.getTime());
};

process.uptime = function() {
    return __processUptime() / 1000;
};

global.onunhandledrejection = function(e) {
    throw e.reason;
};

(function() {
    var oldSetImmediate = global.setImmediate;
    global.setImmediate = function(f) {
        return oldSetImmediate(f);
    };
})();


