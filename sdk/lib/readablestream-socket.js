import { inherits } from 'util';
import { Readable } from 'stream';

function ReadableSocket() {
    Readable.call(this, {});
}
inherits(ReadableSocket, Readable);

ReadableSocket.prototype._close = function(e, result) {
    this.emit('end');
    this.emit('close');
}

ReadableSocket.prototype._error = function(e) {
    this.emit('error', new Error(e.getMessage()));
}

ReadableSocket.prototype._data = function(data) {
    if (data) {
        data = NativeBuffer.toBuffer(data);

        var more = this.push(data);
        if (!more) {
            this._socket.pause();
        }
    }
    else {
        this._socket.resume();
    }
}

ReadableSocket.prototype._read = function (len) {
    // read may be called before socket has connected.
    if (!this._socket) {
        return;
    }

    this._socket.resume();
}

exports.ReadableSocket = ReadableSocket;
