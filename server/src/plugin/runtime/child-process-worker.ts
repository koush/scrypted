import { EventEmitter } from "ws";
import { RuntimeWorker, RuntimeWorkerOptions } from "./runtime-worker";
import child_process from 'child_process';
import { RpcMessage, RpcPeer } from "../../rpc";

export abstract class ChildProcessWorker extends EventEmitter implements RuntimeWorker {
    worker: child_process.ChildProcess;

    constructor(public pluginId: string, options: RuntimeWorkerOptions) {
        super();
    }

    setupWorker() {
        this.worker.on('close', () => this.emit('close'));
        this.worker.on('disconnect', () => this.emit('disconnect'));
        this.worker.on('exit', (code, signal) => this.emit('exit', code, signal));
        this.worker.on('close', () => this.emit('close'));
        this.worker.on('error', e => this.emit('error', e));
    }

    get pid() {
        return this.worker.pid;
    }

    get stdout() {
        return this.worker.stdout;
    }

    get stderr() {
        return this.worker.stderr;
    }

    get killed() {
        return this.worker.killed;
    }

    kill(): void {
        if (!this.worker)
            return;
        this.worker.kill('SIGKILL');
        this.worker.removeAllListeners();
        this.worker.stdout.removeAllListeners();
        this.worker.stderr.removeAllListeners();
        this.worker = undefined;
    }

    abstract send(message: RpcMessage, reject?: (e: Error) => void): void;
    abstract setupRpcPeer(peer: RpcPeer): void;
}
