import { inherits } from 'util';
import { ReadableSocket } from './readablestream-socket';
import { Duplex } from 'stream';

function DuplexSocket() {
    Duplex.call(this, {});
    this._pending = Buffer.alloc(0);
}
inherits(DuplexSocket, Duplex);

DuplexSocket.prototype._close = ReadableSocket.prototype._close;
DuplexSocket.prototype._error = ReadableSocket.prototype._error;
DuplexSocket.prototype._data = ReadableSocket.prototype._data;
DuplexSocket.prototype._read = ReadableSocket.prototype._read;

DuplexSocket.prototype._writable = function() {
    this.emit('_writable');
}

exports.DuplexSocket = DuplexSocket;