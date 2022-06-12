import child_process from 'child_process';
import fs from "fs";
import os from "os";
import path from 'path';
import readline from 'readline';
import { Readable, Writable } from 'stream';
import { RpcMessage, RpcPeer } from "../../rpc";
import { ChildProcessWorker } from "./child-process-worker";
import { RuntimeWorkerOptions } from "./runtime-worker";

export class PythonRuntimeWorker extends ChildProcessWorker {

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

        const gstEnv: NodeJS.ProcessEnv = {};
        // hack to fix gst plugin search path on mac...
        if (os.platform() === 'darwin') {
            const gstPaths = [
                '/opt/homebrew/lib/gstreamer-1.0',
                '/usr/local/lib/gstreamer-1.0',
            ];
            for (const gstPath of gstPaths) {
                if (fs.existsSync(path.join(gstPath, 'libgstx264.dylib'))) {
                    gstEnv['GST_PLUGIN_PATH'] = gstPath;
                    break;
                }
            }
        }

        this.worker = child_process.spawn('python3', args, {
            // stdin, stdout, stderr, peer in, peer out
            stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
            env: Object.assign({
                PYTHONPATH: path.join(process.cwd(), 'node_modules/@scrypted/types'),
            }, gstEnv, process.env, env),
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
