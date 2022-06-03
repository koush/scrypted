import { Server } from "engine.io";

export type IOServer<T> = {
    on(ev: 'connection' | 'drain', fn: (socket: IOSocket & T) => void): IOServer<T>;
} & Server;

export type IOSocket = {
    send(data: any, options?: any, callback?: any): IOSocket;

    on(ev: "close", fn: (reason: string, description?: Error) => void): IOSocket;
    /**
     * Fired when the client sends a message.
     */
    on(ev: "message", fn: (data: string | Buffer) => void): IOSocket;
    /**
     * Fired when an error occurs.
     */
    on(ev: "error", fn: (err: Error) => void): IOSocket;
    /**
     * Called when the write buffer is drained
     */
    on(ev: "drain", fn: () => void): IOSocket;
};
