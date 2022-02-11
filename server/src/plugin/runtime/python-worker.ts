import { RuntimeWorker, RuntimeWorkerOptions as RuntimeWorkerOptions } from "./runtime-worker";
import child_process from 'child_process';
import path from 'path';
import { EventEmitter } from "ws";
import { Writable, Readable } from 'stream';
import { RpcMessage, RpcPeer } from "@scrypted/rpc";
import readline from 'readline';
import { ChildProcessWorker } from "./child-process-worker";

export class PythonRuntimeWorker extends  ChildProcessWorker {

    constructor(pluginId: string, options: RuntimeWorkerOptions) {
        super(pluginId, options);

        const { env, pluginDebug } = options;
        const args: string[] = [
            '-u',
        ];
        if (pluginDebug) {
            args.push(
                '-m',
                'debugpy',
                '--listen',
                `0.0.0.0:${pluginDebug.inspectPort}`,
                '--wait-for-client',
            )
        }
        args.push(
            path.join(__dirname, '../../../python', 'plugin-remote.py'),
        )

        this.worker = child_process.spawn('python3', args, {
            // stdin, stdout, stderr, peer in, peer out
            stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
            env: Object.assign({
                PYTHONPATH: path.join(process.cwd(), 'node_modules/@scrypted/types'),
            }, process.env, env),
        });

        this.setupWorker();
    }

    setupRpcPeer(peer: RpcPeer): void {
        const peerin = this.worker.stdio[3] as Writable;
        const peerout = this.worker.stdio[4] as Readable;

        peerin.on('error', e => this.emit('error', e));
        peerout.on('error', e => this.emit('error', e));

        const readInterface = readline.createInterface({
            input: peerout,
            terminal: false,
        });
        readInterface.on('line', line => peer.handleMessage(JSON.parse(line)));
    }

    send(message: RpcMessage, reject?: (e: Error) => void): void {
        try {
            if (!this.worker)
                throw new Error('worked has been killed');
                (this.worker.stdio[3] as Writable).write(JSON.stringify(message) + '\n', e => e && reject?.(e));
            }
        catch (e) {
            reject?.(e);
        }
    }
}
