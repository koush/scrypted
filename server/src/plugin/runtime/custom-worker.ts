import { ScryptedRuntimeArguments } from '@scrypted/types';
import child_process from 'child_process';
import { Readable, Writable } from 'stream';
import { RpcMessage, RpcPeer } from "../../rpc";
import { createRpcDuplexSerializer } from '../../rpc-serializer';
import type { ScryptedRuntime } from '../../runtime';
import { ChildProcessWorker } from "./child-process-worker";
import { RuntimeWorkerOptions } from "./runtime-worker";

export class CustomRuntimeWorker extends ChildProcessWorker {
    serializer: ReturnType<typeof createRpcDuplexSerializer>;
    fork: boolean;

    constructor(options: RuntimeWorkerOptions, runtime: ScryptedRuntime) {
        super(options);

        const pluginDevice = runtime.findPluginDevice(this.pluginId);
        const scryptedRuntimeArguments: ScryptedRuntimeArguments = pluginDevice.state.scryptedRuntimeArguments?.value;
        if (!scryptedRuntimeArguments)
            throw new Error('custom runtime requires scryptedRuntimeArguments');

        const { env, pluginDebug } = options;

        const args = [...scryptedRuntimeArguments.arguments || []];

        const opts: child_process.ForkOptions | child_process.SpawnOptions = {
            // stdin, stdout, stderr, peer in, peer out
            stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
            env: Object.assign({}, process.env, env, {
                SCRYYPTED_PLUGIN_ID: this.pluginId,
                SCRYPTED_DEBUG_PORT: pluginDebug?.inspectPort?.toString(),
                SCRYPTED_UNZIPPED_PATH: options.unzippedPath,
                SCRYPTED_ZIP_FILE: options.zipFile,
                SCRYPTED_ZIP_HASH: options.zipHash,
            }),
        };

        if (!scryptedRuntimeArguments.executable) {
            this.fork = true;
            const modulePath = args.shift();
            if (!modulePath)
                throw new Error('fork runtime requires modulePath in first argument.');

            (opts.stdio as any)[5] = 'ipc';
            this.worker = child_process.fork(modulePath, args, opts);
        }
        else {
            this.worker = child_process.spawn(scryptedRuntimeArguments.executable, args, opts);
        }

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
