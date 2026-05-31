import type { Server, Socket as ServerSocket } from "engine.io";

export type IOServer = {
    on(ev: 'connection' | 'drain', fn: (socket: IOServerSocket & IOServerSocket) => void): IOServer;
} & Server;

export type IOServerSocket = ServerSocket & IOSocket;

export interface IOSocket {
    send(data: any, options?: any, callback?: any): this;

    on(ev: "close", fn: (reason: string, description?: Error) => void): this;
    /**
     * Fired when the client sends a message.
     */
    on(ev: "message", fn: (data: string | Buffer) => void): this;
    /**
     * Fired when an error occurs.
     */
    on(ev: "error", fn: (err: Error) => void): this;
    /**
     * Called when the write buffer is drained
     */
    on(ev: "drain", fn: () => void): this;
}
