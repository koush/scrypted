import worker_threads from "worker_threads";
import { EventEmitter } from "events";
import { RpcMessage, RpcPeer, RpcSerializer } from "../../rpc";
import { RuntimeWorker, RuntimeWorkerOptions } from "./runtime-worker";
import { BufferSerializer } from '../../rpc-buffer-serializer';


class BufferTransfer implements RpcSerializer {
    bufferSerializer = new BufferSerializer();

    serialize(value: Buffer, serializationContext?: any): any {
        if (!serializationContext)
            return this.bufferSerializer.serialize(value);

        // node may used pooled buffers for Buffer.allocUnsafe, Buffer.from, and other calls.
        // these buffers will be smaller than Buffer.poolSize.
        // In these instances, do not transfer the buffer, as it may not be transferible.
        // create a copy so it can be safely transfered.
        if (value.buffer.byteLength <= Buffer.poolSize) {
            const ab = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
            value = Buffer.from(ab);
        }

        serializationContext.transferList ||= [];
        const transferList: worker_threads.TransferListItem[] = serializationContext.transferList;
        transferList.push(value.buffer);
        // can return the value directly, as the buffer is transferred.
        return value;
    }

    deserialize(serialized: any, serializationContext?: any): any {
        if (!serializationContext?.transferList)
            return this.bufferSerializer.deserialize(serialized);
        // the buffer was transferred, so we can return the value directly.
        const u: Uint8Array = serialized;
        return Buffer.from(u.buffer, u.byteOffset, u.byteLength);
    }
}

interface PortMessage {
    message: any;
    serializationContext: any;
}

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
            const postMessage: PortMessage = {
                message,
                serializationContext,
            };
            const transferList: worker_threads.TransferListItem[] = serializationContext?.transferList;
            // delete the transfer list since that is simply transfered.
            if (transferList)
                serializationContext.transferList = [];
            port.postMessage(postMessage, transferList);
        }
        catch (e) {
            reject?.(e);
        }
    }

    static setupRpcPeer(peer: RpcPeer, port: worker_threads.MessagePort) {
        port.on('message', (portMessage: PortMessage) => {
            const { message, serializationContext } = portMessage;
            peer.handleMessage(message, serializationContext);
        });
        peer.addSerializer(Buffer, 'Buffer', new BufferTransfer());
        peer.addSerializer(Uint8Array, 'Uint8Array', new BufferTransfer());
    }

    static createRpcPeer(selfName: string, peerName: string, port: worker_threads.MessagePort): RpcPeer {
        const peer = new RpcPeer(selfName, peerName, (message, reject, serializationContext) => NodeThreadWorker.send(message, port, reject, serializationContext));
        NodeThreadWorker.setupRpcPeer(peer, port);
        return peer;
    }
}
