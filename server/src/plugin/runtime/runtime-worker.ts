import net from "net";
import { Readable } from "stream";
import { RpcMessage, RpcPeer } from "../../rpc";
import { PluginDebug } from "../plugin-debug";

export interface RuntimeWorkerOptions {
    packageJson: any;
    pluginDebug: PluginDebug;
    zipFile: string,
    unzippedPath: string;
    zipHash: string;
    env: any;
}

export interface RuntimeWorker {
    pid: number;
    stdout: Readable;
    stderr: Readable;
    killPromise: Promise<any>;

    kill(): void;

    on(event: 'rpc', listener: (message: any, sendHandle: net.Socket) => void): this;

    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;

    once(event: 'error', listener: (err: Error) => void): this;
    once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;

    removeListener(event: 'error', listener: (err: Error) => void): this;
    removeListener(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;

    send(message: RpcMessage, reject?: (e: Error) => void, serializationContext?: any): void;

    setupRpcPeer(peer: RpcPeer): void;
}
