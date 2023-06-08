import child_process from 'child_process';
import fs from "fs";
import os from "os";
import path from 'path';
import { Readable, Writable } from 'stream';
import { RpcMessage, RpcPeer } from "../../rpc";
import { createRpcDuplexSerializer } from '../../rpc-serializer';
import { ChildProcessWorker } from "./child-process-worker";
import { RuntimeWorkerOptions } from "./runtime-worker";

export class PythonRuntimeWorker extends ChildProcessWorker {
    serializer: ReturnType<typeof createRpcDuplexSerializer>;

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
            path.join(__dirname, '../../../python', 'plugin_remote.py'),
        )

        const gstEnv: NodeJS.ProcessEnv = {};
        // hack to fix gst plugin search path on mac...
        if (os.platform() === 'darwin') {
            const gstPaths = [
                '/opt/homebrew/lib/gstreamer-1.0',
                '/usr/local/lib/gstreamer-1.0',
            ];
            for (const gstPath of gstPaths) {
                // search for common plugins.
                if (fs.existsSync(path.join(gstPath, 'libgstx264.dylib'))
                    || fs.existsSync(path.join(gstPath, 'libgstlibav.dylib'))
                    || fs.existsSync(path.join(gstPath, 'libgstvideotestsrc.dylib'))) {
                    gstEnv['GST_PLUGIN_PATH'] = gstPath;
                    break;
                }
            }
        }

        let pythonPath = process.env.SCRYPTED_PYTHON_PATH;
        const pluginPythonVersion = options.packageJson.scrypted.pythonVersion?.[os.platform()]?.[os.arch()] || options.packageJson.scrypted.pythonVersion?.default;

        if (os.platform() === 'win32') {
            pythonPath ||= 'py.exe';
            const windowsPythonVersion = pluginPythonVersion || process.env.SCRYPTED_WINDOWS_PYTHON_VERSION;
            if (windowsPythonVersion)
                args.unshift(windowsPythonVersion)
        }
        else if (pluginPythonVersion) {
            pythonPath = `python${pluginPythonVersion}`;
        }
        else {
            pythonPath ||= 'python3';
        }

        args.push(this.pluginId);

        const types = require.resolve('@scrypted/types');
        const PYTHONPATH = types.substring(0, types.indexOf('types') + 'types'.length);
        this.worker = child_process.spawn(pythonPath, args, {
            // stdin, stdout, stderr, peer in, peer out
            stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
            env: Object.assign({
                PYTHONUNBUFFERED: '1',
                PYTHONPATH,
            }, gstEnv, process.env, env),
        });

        this.setupWorker();
    }

    setupRpcPeer(peer: RpcPeer): void {
        const peerin = this.worker.stdio[3] as Writable;
        const peerout = this.worker.stdio[4] as Readable;

        const serializer = this.serializer = createRpcDuplexSerializer(peerin);
        serializer.setupRpcPeer(peer);
        peerout.on('data', data => serializer.onData(data));
        peerin.on('error', e => {
            this.emit('error', e);
            serializer.onDisconnected();
        });
        peerout.on('error', e => {
            this.emit('error', e)
            serializer.onDisconnected();
        });
    }

    send(message: RpcMessage, reject?: (e: Error) => void, serializationContext?: any): void {
        try {
            if (!this.worker)
                throw new Error('python worker has been killed');
            this.serializer.sendMessage(message, reject, serializationContext);
        }
        catch (e) {
            reject?.(e);
        }
    }
}
