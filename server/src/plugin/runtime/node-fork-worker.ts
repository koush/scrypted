import { RuntimeWorker, RuntimeWorkerOptions as RuntimeWorkerOptions } from "./runtime-worker";
import child_process from 'child_process';
import path from 'path';
import { EventEmitter } from "ws";
import { RpcMessage, RpcPeer } from "../../rpc";
import { ChildProcessWorker } from "./child-process-worker";

export class NodeForkWorker extends ChildProcessWorker {

    constructor(pluginId: string, options: RuntimeWorkerOptions) {
        super(pluginId, options);
        
        const {env, pluginDebug} = options;
        
        const execArgv: string[] = process.execArgv.slice();
        if (pluginDebug) {
            execArgv.push(`--inspect=0.0.0.0:${pluginDebug.inspectPort}`);
        }

        this.worker = child_process.fork(require.main.filename, ['child', this.pluginId], {
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            env: Object.assign({}, process.env, env),
            serialization: 'advanced',
            execArgv,
        });
        this.worker.on('message', message => this.emit('message', message));

        this.setupWorker();
    }

    setupRpcPeer(peer: RpcPeer): void {
        this.worker.on('message', message => peer.handleMessage(message as any));
        peer.transportSafeArgumentTypes.add(Buffer.name);
    }

    send(message: RpcMessage, reject?: (e: Error) => void): void {
        this.worker.send(message, undefined, e => {
            if (e && reject)
                reject(e);
        });
    }

    get pid() {
        return this.worker.pid;
    }
}
