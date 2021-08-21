import EventEmitter from 'events';
import { inherits } from 'util';

function Udp(family) {
    EventEmitter.call(this);
    this.family = family.type || family;
}

inherits(Udp, EventEmitter);

Udp.prototype.close = function() {
    if (this.socket) {
        this.socket.close();
        this.socket = null;
    }
}

Udp.prototype.bind = function() {
    var port;
    var address;
    var cb;

    var type = typeof arguments[0];
    if (type == 'function') {
        cb = arguments[0];
        port = 0;
    }
    else if (type == 'number') {
        port = arguments[0];
        type = typeof arguments[1];
        if (type == 'function') {
            cb = arguments[1];
        }
        else {
            address = arguments[1];
            if (arguments.length >= 2) {
                cb = arguments[2];
            }
        }
    }
    else if (type == 'object') {
        var port = arguments[0].port || 0;
        var address = arguments[0].address;
        cb = arguments[1];
    }
    else {
        throw new Error('unexpected argument');
    }

    if (!address) {
        if (this.family == 'udp4') {
            address = "0.0.0.0";
        }
        else if (this.family == 'udp6') {
            address = "::";
        }
    }

    this.ensureSocket(address, port, cb);
}

Udp.prototype.setBroadcast = function(broadcast) {
    __datagramSetBroadcast(this.socket, broadcast);
}

Udp.prototype.send = function() {
    var i = 0;
    var message = arguments[i++];
    var offset = 0;
    var length = message.length;
    var port;
    var address;
    var cb;
    if (typeof arguments[i] == 'number' && typeof arguments[i + 1] == 'number') {
        offset = arguments[i++];
        length = arguments[i++];
    }
    port = arguments[i++];
    if (typeof arguments[i] == 'string') {
        address = arguments[i++]
    }
    cb = arguments[i++];

    var ui = new Uint8Array(message)
    if (cb != null) {
        var wrappedCb = cb;
        cb = function(err) {
            if (!err)
                wrappedCb(null, ui.length)
            else
                wrappedCb(err)
        }
    }

    return __datagramSend(this.socket, ui, offset, length, port, address, cb);
}

Udp.prototype.address = function() {
    return null;
}
Udp.prototype.unref = function() {
}

Udp.prototype.ensureSocket = function(address, port, cb) {
    if (this.socket) {
        cb();
        return;
    }

    __datagramCreate(address, port,
    function socketCallback(e, result) {
        if (e != null) {
            this.emit('error', new Error(e.getMessage()));
            return;
        }

        this.socket = result;
        this.address = result.getLocalAddress().getHostAddress();
        this.port = result.getLocalPort();
        if (cb) {
            cb();
        }
    }.bind(this),
    function closeCallback() {
        this.emit('close')
    }.bind(this),
    function errorCallback(e) {
        this.emit('error', new Error(e.getMessage()));
    }.bind(this),
    function messageCallback(data, remoteAddress) {
        var buffer = new Buffer(data);
        var rinfo = {
            address: remoteAddress.getHostString(),
            family: 'IPv4',
            port: remoteAddress.getPort(),
            size: data.length,
        }
        this.emit('message', buffer, rinfo);
    }.bind(this));
}

// events...
// error
// message

function createSocket(family, cb) {
    var ret = new Udp(family);
    if (cb) {
        ret.on('data', cb);
    }
    return ret;
}

export {
    createSocket
}