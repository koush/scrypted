import v8 from 'v8';
import worker_threads from "worker_threads";
import { EventEmitter } from "ws";
import { RpcMessage, RpcPeer } from "../../rpc";
import { RuntimeWorker, RuntimeWorkerOptions } from "./runtime-worker";

export class NodeThreadWorker extends EventEmitter implements RuntimeWorker {
    worker: worker_threads.Worker;
    message = new worker_threads.MessageChannel();

    constructor(mainFilename: string, public pluginId: string, options: RuntimeWorkerOptions) {
        super();
        const { env } = options;

        this.worker = new worker_threads.Worker(mainFilename, {
            argv: ['child-thread', this.pluginId],
            env: Object.assign({}, process.env, env),
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

        this.message.port2.on('messageerror', e => {
            this.emit('error', e);
        });
        this.message.port2.on('close', () => {
            this.emit('error', new Error('port closed'));
        });

        this.worker.postMessage({
            port: this.message.port1,
        }, [this.message.port1]);
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
        this.message.port1.close();
        this.message.port2.close();
        this.message = undefined;
        this.worker = undefined;
    }

    send(message: RpcMessage, reject?: (e: Error) => void): void {
        try {
            if (!this.worker)
                throw new Error('thread worker has been killed');
            this.message.port2.postMessage(v8.serialize(message));
        }
        catch (e) {
            reject?.(e);
        }
    }

    setupRpcPeer(peer: RpcPeer): void {
        this.message.port2.on('message', message => peer.handleMessage(v8.deserialize(message)));
    }
}
