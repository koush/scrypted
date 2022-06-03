import type { Server, Socket as ServerSocket } from "engine.io";
import type { Socket as ClientSocket } from "engine.io-client";

export type IOServer = {
    on(ev: 'connection' | 'drain', fn: (socket: IOServerSocket & IOServerSocket) => void): IOServer;
} & Server;

export type IOServerSocket = IOSocket & ServerSocket;
export type IOClientSocket = IOSocket & ClientSocket;

export type IOSocket = {
    send(data: any, options?: any, callback?: any): IOServerSocket;

    on(ev: "close", fn: (reason: string, description?: Error) => void): IOServerSocket;
    /**
     * Fired when the client sends a message.
     */
    on(ev: "message", fn: (data: string | Buffer) => void): IOServerSocket;
    /**
     * Fired when an error occurs.
     */
    on(ev: "error", fn: (err: Error) => void): IOServerSocket;
    /**
     * Called when the write buffer is drained
     */
    on(ev: "drain", fn: () => void): IOServerSocket;
}
