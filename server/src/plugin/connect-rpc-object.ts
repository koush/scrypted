import net from "net";
import { Socket } from "engine.io";
import { IOSocket } from "../io";
import { ScryptedRuntime } from "../runtime";

/*
 * Handle incoming connections that will be
 * proxied to a connectRPCObject socket.
 */
export function setupConnectRPCObjectProxy(scrypted: ScryptedRuntime, port: number, connection: Socket & IOSocket) {
    if (!port) {
        throw new Error("invalid port");
    }

    connection.send(scrypted.clusterSecret);

    const socket = net.connect(port, '127.0.0.1');
    socket.on('close', () => connection.close());
    socket.on('data', data => connection.send(data));
    connection.on('close', () => socket.destroy());
    connection.on('message', message => socket.write(message));
};
