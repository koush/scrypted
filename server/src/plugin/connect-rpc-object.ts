import crypto from "crypto";
import net from "net";
import { Socket } from "engine.io";
import { IOSocket } from "../io";

export interface ClusterObject {
    id: string;
    port: number;
    proxyId: string;
    sourcePort: number;
    sha256: string;
}

export type ConnectRPCObject = (o: ClusterObject) => Promise<any>;

/*
 * Handle incoming connections that will be
 * proxied to a connectRPCObject socket.
 *
 * It is the responsibility of the caller of
 * this function to verify the signature of
 * clusterObject using the clusterSecret.
 */
export function setupConnectRPCObjectProxy(clusterObject: ClusterObject, connection: Socket & IOSocket) {
    const socket = net.connect(clusterObject.port, '127.0.0.1');
    socket.on('close', () => connection.close());
    socket.on('data', data => connection.send(data));
    connection.on('close', () => socket.destroy());
    connection.on('message', message => socket.write(message));
};


export function computeClusterObjectHash(o: ClusterObject, clusterSecret: string) {
    const sha256 = crypto.createHash('sha256').update(`${o.id}${o.port}${o.sourcePort || ''}${o.proxyId}${clusterSecret}`).digest().toString('base64');
    return sha256;
}
