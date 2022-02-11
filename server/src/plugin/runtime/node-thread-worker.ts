import { Readable } from "stream";
import { EventEmitter } from "ws";
import { RpcMessage, RpcPeer } from "@scrypted/rpc";
import { RuntimeWorker, RuntimeWorkerOptions } from "./runtime-worker";
import worker_threads from "worker_threads";
import path from 'path';
import { getPluginNodePath } from "../plugin-npm-dependencies";
import v8 from 'v8';

export class NodeThreadWorker extends EventEmitter implements RuntimeWorker {
    terminated: boolean;
    worker: worker_threads.Worker;

    constructor(public pluginId: string, options: RuntimeWorkerOptions) {
        super();
        const { env } = options;

        this.worker = new worker_threads.Worker(require.main.filename, {
            argv: ['child-thread', this.pluginId],
            env: Object.assign({}, process.env, env, {
                NODE_PATH: path.join(getPluginNodePath(this.pluginId), 'node_modules'),
            }),
        });

        this.worker.on('exit', () => {
            this.terminated = true;
            this.emit('exit');
        });
        this.worker.on('error', e => {
            this.emit('error', e);
        });
        this.worker.on('messageerror', e => {
            this.emit('error', e);
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

    get killed() {
        return this.terminated;
    }

    kill(): void {
        if (!this.worker)
            return;
        this.worker.terminate();
        this.worker.removeAllListeners();
        this.worker.stdout.removeAllListeners();
        this.worker.stderr.removeAllListeners();
        this.worker = undefined;
    }

    send(message: RpcMessage, reject?: (e: Error) => void): void {
        try {
            if (!this.worker)
                throw new Error('worked has been killed');
            this.worker.postMessage(v8.serialize(message));
        }
        catch (e) {
            reject?.(e);
        }
    }

    setupRpcPeer(peer: RpcPeer): void {
        this.worker.on('message', message => peer.handleMessage(v8.deserialize(message)));
    }
}
