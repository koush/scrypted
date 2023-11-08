import net from "net";
import { Socket } from "engine.io";
import { IOSocket } from "../io";

export interface ClusterObject {
    id: string;
    port: number;
    proxyId: string;
    source: number;
}

export type ConnectRPCObject = (id: string, secret: string, sourcePeerPort: number) => Promise<any>;

/*
 * Handle incoming connections that will be
 * proxied to a connectRPCObject socket.
 */
export function setupConnectRPCObjectProxy(clusterSecret: string, port: number, connection: Socket & IOSocket) {
    if (!port) {
        throw new Error("invalid port");
    }

    connection.send(clusterSecret);

    const socket = net.connect(port, '127.0.0.1');
    socket.on('close', () => connection.close());
    socket.on('data', data => connection.send(data));
    connection.on('close', () => socket.destroy());
    connection.on('message', message => socket.write(message));
};
