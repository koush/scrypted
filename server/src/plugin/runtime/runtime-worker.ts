import { RpcMessage, RpcPeer } from "../../rpc";
import { PluginDebug } from "../plugin-debug";
import {Readable} from "stream";

export interface RuntimeWorkerOptions {
    pluginDebug: PluginDebug;
    env: any;
}

export interface RuntimeWorker {
    pid: number;
    stdout: Readable;
    stderr: Readable;
    killed: boolean;

    kill(): void;

    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
    on(event: 'disconnect', listener: () => void): this;
    on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
    once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;

    send(message: RpcMessage, reject?: (e: Error) => void): void;

    setupRpcPeer(peer: RpcPeer): void;
}

