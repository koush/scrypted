const { Buffer } = require('buffer');

// QuickJS has ArrayBuffer but not Buffer.
// Attempt to convert the Buffer object to ArrayBuffer,
// and vice versa, when they are encountered.
// Leave other types untouched, so strings etc, will simply pass through.
var NativeBuffer = {
    // if the object is a Buffer, convert it to an ArrayBuffer, otherwise leave as is
    from: function(buffer) {
        if (buffer && buffer.constructor && buffer.constructor.name === Buffer.name) {
            return buffer.buffer;
        }
        return buffer;
    },
    toBuffer: function(buffer) {
        if (buffer && (buffer.constructor.name === ArrayBuffer.name || buffer.constructor.name === Uint8Array.name)) {
            var ret = Buffer.from(buffer);
            return ret;
        }
        return buffer;
    }
};

global.NativeBuffer = NativeBuffer;