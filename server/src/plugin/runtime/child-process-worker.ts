import child_process from 'child_process';
import { once } from 'events';
import { EventEmitter } from "ws";
import { RpcMessage, RpcPeer } from "../../rpc";
import { RuntimeWorker, RuntimeWorkerOptions } from "./runtime-worker";

export abstract class ChildProcessWorker extends EventEmitter implements RuntimeWorker {
    public pluginId: string;
    protected worker: child_process.ChildProcess;
    killPromise: Promise<void>;

    get childProcess() {
        return this.worker;
    }

    constructor(options: RuntimeWorkerOptions) {
        super();
        this.pluginId = options.packageJson.name;

    }

    setupWorker() {
        this.worker.on('close', () => this.emit('error', new Error('close')));
        this.worker.on('disconnect', () => this.emit('error', new Error('disconnect')));
        this.worker.on('exit', (code, signal) => this.emit('exit', code, signal));
        this.worker.on('error', e => this.emit('error', e));
        // aggressively catch errors
        // ECONNRESET can be raised when the child process is killed
        for (const stdio of this.worker.stdio || []) {
            if (stdio)
                stdio.on('error', e => this.emit('error', e));
        }

        this.killPromise = once(this.worker, 'exit').then(() => {}).catch(() => {});
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
        const { worker } = this;
        if (!worker)
            return;
        this.worker = undefined;
        worker.kill();
        setTimeout(() => worker.kill('SIGKILL'), 1000);
    }

    abstract send(message: RpcMessage, reject?: (e: Error) => void): void;
    abstract setupRpcPeer(peer: RpcPeer): void;
}
