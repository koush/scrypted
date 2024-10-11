import child_process from 'child_process';
import { EventEmitter } from "ws";
import { RpcMessage, RpcPeer } from "../../rpc";
import { RuntimeWorker, RuntimeWorkerOptions } from "./runtime-worker";

export abstract class ChildProcessWorker extends EventEmitter implements RuntimeWorker {
    protected worker: child_process.ChildProcess;

    get childProcess() {
        return this.worker;
    }

    constructor(public pluginId: string, options: RuntimeWorkerOptions) {
        super();
    }

    setupWorker() {
        this.worker.on('close', (code: number | null, signal: NodeJS.Signals | null) => this.emit('close', code, signal));
        this.worker.on('disconnect', () => this.emit('error', new Error('disconnect')));
        this.worker.on('exit', (code, signal) => this.emit('exit', code, signal));
        this.worker.on('error', e => this.emit('error', e));
        // aggressively catch errors
        // ECONNRESET can be raised when the child process is killed
        for (const stdio of this.worker.stdio || []) {
            if (stdio)
                stdio.on('error', e => this.emit('error', e));
        }
    }

    get pid() {
        return this.worker?.pid;
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
        this.worker.kill('SIGKILL');
        this.worker = undefined;
    }

    abstract send(message: RpcMessage, reject?: (e: Error) => void): void;
    abstract setupRpcPeer(peer: RpcPeer): void;
}
