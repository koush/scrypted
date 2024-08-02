import v8 from 'v8';
import worker_threads from "worker_threads";
import { EventEmitter } from "events";
import { RpcMessage, RpcPeer } from "../../rpc";
import { RuntimeWorker, RuntimeWorkerOptions } from "./runtime-worker";

export class NodeThreadWorker extends EventEmitter implements RuntimeWorker {
    worker: worker_threads.Worker;
    port: worker_threads.MessagePort;

    constructor(mainFilename: string, public pluginId: string, options: RuntimeWorkerOptions, workerOptions?: worker_threads.WorkerOptions) {
        super();
        const { env } = options;

        const message = new worker_threads.MessageChannel();
        const { port1, port2 } = message;
        this.worker = new worker_threads.Worker(mainFilename, {
            argv: ['child-thread', this.pluginId],
            env: Object.assign({}, process.env, env),
            workerData: {
                port: port1,
            },
            transferList: [port1],
            ...workerOptions,
        });

        this.worker.on('exit', () => {
            this.emit('exit');
        });
        this.worker.on('error', e => {
            this.emit('error', e);
        });
        this.worker.on('messageerror', e => {
            this.emit('error', e);
        });

        this.port = port2;
        this.port.on('messageerror', e => {
            this.emit('error', e);
        });
        this.port.on('close', () => {
            this.emit('error', new Error('port closed'));
        });
    }

    get pid() {
        return this.worker.threadId;
    }

    get stdout() {
        return this.worker.stdout;
    }

    get stderr() {
        return this.worker.stderr;
    }

    kill(): void {
        if (!this.worker)
            return;
        this.worker.terminate();
        this.worker.removeAllListeners();
        this.worker.stdout.removeAllListeners();
        this.worker.stderr.removeAllListeners();
        this.port.close();
        this.port = undefined;
        this.worker = undefined;
    }

    send(message: RpcMessage, reject?: (e: Error) => void): void {
        try {
            if (!this.worker)
                throw new Error('thread worker has been killed');
            this.port.postMessage(v8.serialize(message));
        }
        catch (e) {
            reject?.(e);
        }
    }

    setupRpcPeer(peer: RpcPeer): void {
        this.port.on('message', message => peer.handleMessage(v8.deserialize(message)));
    }
}
