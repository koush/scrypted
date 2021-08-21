const bufferToString = Buffer.prototype.toString;
const bufferWrite = Buffer.prototype.write;

Buffer.prototype.toString = function (encoding, start, end) {
    if (!encoding) {
        return bufferToString.apply(this, arguments);
    }
    return __bufferToString(this, encoding, start ? start : 0, end ? end : this.byteLength);
}

Object.defineProperty(Buffer.prototype, "length", {
    get: function () {
        return this.byteLength;
    },
    set: function () {
        throw new Error("length is readonly")
    }
});

Object.defineProperty(Buffer.prototype, "parent", {
    get: function () {
        return this.buffer;
    },
    set: function () {
        throw new Error("parent is readonly")
    }
});

Object.defineProperty(ArrayBuffer.prototype, "length", {
    get: function () {
        return this.byteLength;
    },
    set: function () {
        throw new Error("length is readonly")
    }
});

Buffer.prototype.write = function (string) {
    var offset;
    var length;
    var encoding;
    var i = 1;
    if (typeof arguments[i] == 'string') {
        encoding = arguments[i++];
    }
    else {
        offset = arguments[i++];
        if (typeof arguments[i] == 'string') {
            encoding = arguments[i++];
        }
        else {
            length = arguments[i++];
            encoding = arguments[i++];
        }
    }

    if (!encoding || encoding == 'utf8') {
        return bufferWrite.apply(this, arguments);
    }

    if (!offset) {
        offset = 0;
    }
    if (!length) {
        length = this.length - offset;
    }

    var buf = Buffer.from(string, encoding);
    var writeLength = Math.min(this.byteLength - offset, buf.byteLength, length);

    buf.copy(this, offset, 0, offset + writeLength);
}

// patch up buffer constructor to accept encoding for strings
var OldBuffer = global.Buffer;
(function() {
    function Buffer() {
        if (typeof arguments[0] == 'number') {
            return new OldBuffer(arguments[0]);
        }
        return Buffer.from.apply(this, arguments);
    }
    global.Buffer = Buffer;
})();
Buffer.prototype = OldBuffer.prototype;
Buffer.prototype.constructor = Buffer;

Buffer.isEncoding = OldBuffer.isEncoding;
Buffer.isBuffer = OldBuffer.isBuffer;
Buffer.compare = OldBuffer.compare;
Buffer.concat = OldBuffer.concat;

Buffer.alloc = function (len) {
    return new OldBuffer(len);
}
Buffer.allocUnsafe = Buffer.alloc;

Buffer.from = function() {
    if (typeof arguments[0] == 'string') {
        return new OldBuffer(__stringToBuffer(arguments[0], arguments[1] || 'utf8'));
    }
    else if (typeof arguments[1] == 'number') {
        var ret = new OldBuffer(arguments[0]);
        if (typeof arguments[2] == 'number') {
            return ret.slice(arguments[1], arguments[1] + arguments[2]);
        }
        return ret.slice(arguments[1]);
    }
    return new OldBuffer(arguments[0]);
}

Buffer.byteLength = function(str, encoding) {
    return Buffer.from(str, encoding).byteLength;
}

var NativeBuffer = {
    from: function(buffer) {
        // no op.
        return buffer;
    },
    toBuffer: function(buffer) {
        return buffer;
    }
};

global.NativeBuffer = NativeBuffer;