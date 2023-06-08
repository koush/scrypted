import { RpcMessage, RpcPeer } from "../../rpc";
import { PluginDebug } from "../plugin-debug";
import { Readable } from "stream";
import net from "net";

export interface RuntimeWorkerOptions {
    packageJson: any;
    pluginDebug: PluginDebug;
    env: any;
}

export interface RuntimeWorker {
    pid: number;
    stdout: Readable;
    stderr: Readable;
    killed: boolean;

    kill(): void;

    on(event: 'rpc', listener: (message: any, sendHandle: net.Socket) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
    on(event: 'disconnect', listener: () => void): this;
    on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
    once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;

    send(message: RpcMessage, reject?: (e: Error) => void, serializationContext?: any): void;

    setupRpcPeer(peer: RpcPeer): void;
}
