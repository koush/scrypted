import { getDenoPath } from '@scrypted/deno';
import child_process from 'child_process';
import path from 'path';
import { RpcMessage, RpcPeer } from "../../rpc";
import { createRpcDuplexSerializer } from '../../rpc-serializer';
import { ChildProcessWorker } from "./child-process-worker";
import { RuntimeWorkerOptions } from "./runtime-worker";

export class DenoWorker extends ChildProcessWorker {
    serializer: ReturnType<typeof createRpcDuplexSerializer>;

    constructor(mainFilename: string, pluginId: string, options: RuntimeWorkerOptions) {
        super(pluginId, options);

        const { env, pluginDebug } = options;

        const execArgv: string[] = [];
        if (pluginDebug) {
            execArgv.push(`--inspect=0.0.0.0:${pluginDebug.inspectPort}`);
        }

        const args = [
            '--unstable-byonm', '--unstable-bare-node-builtins', '--unstable-sloppy-imports', '--unstable-webgpu',
            'run',
            ...execArgv,
            '--allow-all',
            path.join(__dirname, '../../../deno', 'deno-plugin-remote.js'),
            // TODO: send this across.
            // mainFilename.replace('dist', 'src').replace('.js', '.ts'),
            'child', this.pluginId
        ];
        this.worker = child_process.spawn(getDenoPath(), args, {
            // stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            env: Object.assign({
                SCRYPTED_MAIN_FILENAME: mainFilename,
                RUST_BACKTRACE: "full",
            }, process.env, env),
            serialization: 'json',
            // execArgv,
        });

        this.setupWorker();
    }

    setupRpcPeer(peer: RpcPeer): void {
        this.worker.on('message', (message, sendHandle) => {
            if ((message as any).type && sendHandle) {
                peer.handleMessage(message as any, {
                    sendHandle,
                });
            }
            else if (sendHandle) {
                this.emit('rpc', message, sendHandle);
            }
            else {
                peer.handleMessage(message as any);
            }
        });
        peer.transportSafeArgumentTypes.add(Buffer.name);
        peer.transportSafeArgumentTypes.add(Uint8Array.name);
    }

    send(message: RpcMessage, reject?: (e: Error) => void, serializationContext?: any): void {
        try {
            if (!this.worker)
                throw new Error('fork worker has been killed');
            this.worker.send(message, serializationContext?.sendHandle, e => {
                if (e && reject)
                    reject(e);
            });
        }
        catch (e) {
            reject?.(e);
        }
    }
}
