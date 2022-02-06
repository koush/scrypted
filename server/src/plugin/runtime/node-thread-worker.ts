import { Readable } from "stream";
import { EventEmitter } from "ws";
import { RpcMessage, RpcPeer } from "../../rpc";
import { RuntimeWorker, RuntimeWorkerOptions } from "./runtime-worker";
import worker_threads from "worker_threads";

export class NodeThreadWorker extends EventEmitter implements RuntimeWorker {
    pid: number;
    terminated: boolean;
    worker: worker_threads.Worker;

    constructor(public pluginId: string, options: RuntimeWorkerOptions) {
        super();
        const { env } = options;

        this.worker = new worker_threads.Worker(require.main.filename, {
            argv: ['child-thread', this.pluginId],
            env: Object.assign({}, process.env, env),
        });

        this.worker.on('exit', () => {
            this.terminated = true;
            this.emit('exit');
        });
        this.worker.on('error', e => this.emit('error', e));
        this.worker.on('messageerror', e => this.emit('error', e));
    }

    get stdout() {
        return this.worker.stdout;
    }

    get stderr() {
        return this.worker.stderr;
    }

    get killed() {
        return this.terminated;
    }

    kill(): void {
        this.worker.terminate();
    }

    send(message: RpcMessage, reject?: (e: Error) => void): void {
        try {
            this.worker.postMessage(message)
        }
        catch (e) {
            reject?.(e);
        }
    }

    setupRpcPeer(peer: RpcPeer): void {
        this.worker.on('message', message => peer.handleMessage(message));
    }
}
