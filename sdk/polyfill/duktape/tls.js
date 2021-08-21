import { inherits } from 'util';
import { Socket } from 'net';

function TLSSocket() {
    Socket.call(this);
    this.__type = "tls-tcp";
}
inherits(TLSSocket, Socket);


function createConnection() {
    var socket = new TLSSocket();
    socket.connect.apply(socket, arguments);
    return socket;
}
const connect = createConnection;

export {
    TLSSocket,
    createConnection,
    connect,
}
