import v8 from 'v8';
import worker_threads from "worker_threads";
import { EventEmitter } from "events";
import { RpcMessage, RpcPeer } from "../../rpc";
import { RuntimeWorker, RuntimeWorkerOptions } from "./runtime-worker";

export class NodeThreadWorker extends EventEmitter implements RuntimeWorker {
    worker: worker_threads.Worker;
    port: worker_threads.MessagePort;

    constructor(mainFilename: string, public pluginId: string, options: RuntimeWorkerOptions, workerOptions?: worker_threads.WorkerOptions, workerData?: any, transferList: Array<worker_threads.TransferListItem> = []) {
        super();
        const { env } = options;

        const message = new worker_threads.MessageChannel();
        const { port1, port2 } = message;
        this.worker = new worker_threads.Worker(mainFilename, {
            argv: ['child-thread', this.pluginId],
            env: Object.assign({}, process.env, env),
            workerData: {
                port: port1,
                ...workerData,
            },
            transferList: [port1, ...transferList],
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

    send(message: RpcMessage, reject?: (e: Error) => void, serializationContext?: any): void {
        NodeThreadWorker.send(message, this.port, reject, serializationContext);
    }

    setupRpcPeer(peer: RpcPeer): void {
        NodeThreadWorker.setupRpcPeer(peer, this.port);
    }

    static send(message: RpcMessage, port: worker_threads.MessagePort, reject?: (e: Error) => void, serializationContext?: any) {
        try {
            port.postMessage(v8.serialize(message));
        }
        catch (e) {
            reject?.(e);
        }
    }

    static setupRpcPeer(peer: RpcPeer, port: worker_threads.MessagePort) {
        port.on('message', message => peer.handleMessage(v8.deserialize(message)));
        peer.transportSafeArgumentTypes.add(Buffer.name);
        peer.transportSafeArgumentTypes.add(Uint8Array.name);
    }

    static createRpcPeer(selfName: string, peerName: string, port: worker_threads.MessagePort): RpcPeer {
        const peer = new RpcPeer(selfName, peerName, (message, reject, serializationContext) => NodeThreadWorker.send(message, port, reject, serializationContext));
        NodeThreadWorker.setupRpcPeer(peer, port);
        return peer;
    }
}
