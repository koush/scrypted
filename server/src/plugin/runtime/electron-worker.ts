import path from 'path';
import child_process from 'child_process';
import net from "net";
import { RpcMessage, RpcPeer } from "../../rpc";
import { SidebandSocketSerializer } from "../socket-serializer";
import { ChildProcessWorker } from "./child-process-worker";
import { RuntimeWorkerOptions } from "./runtime-worker";
import type { ScryptedRuntime } from '../../runtime';

export class ElectronForkWorker extends ChildProcessWorker {
    static allocatedDisplays = new Set<number>();
    allocatedDisplay: number;

    constructor(_mainFilename: string, pluginId: string, options: RuntimeWorkerOptions, runtime: ScryptedRuntime) {
        super(pluginId, options);

        const { env } = options;

        // @ts-expect-error
        const electronBin: string = require('electron');
        const args = [electronBin];
        if (process.platform === 'linux') {
            // crappy but should work.
            for (let i = 50; i < 100; i++) {
                if (!ElectronForkWorker.allocatedDisplays.has(i)) {
                    this.allocatedDisplay = i;
                    break;
                }
            }

            if (!this.allocatedDisplay)
                throw new Error('unable to allocate DISPLAY for xvfb-run');

            ElectronForkWorker.allocatedDisplays.add(this.allocatedDisplay);

            // requires xvfb-run as electron does not support the chrome --headless flag.
            // dummy up a DISPLAY env variable. this value numerical because of the way it is.
            args.unshift('xvfb-run', '-n', this.allocatedDisplay.toString());
            // https://github.com/gpuweb/gpuweb/wiki/Implementation-Status#chromium-chrome-edge-etc
            args.push('--no-sandbox', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan', '--disable-vulkan-surface');
        }

        if (process.platform === 'darwin') {
            // Electron plist must be modified with this to hide dock icon before start. app.dock.hide flashes the dock before program starts.
            // <key>LSUIElement</key>
            // <string>1</string>
        }

        if (options?.pluginDebug) {
            args.push(`--remote-debugging-port=${options?.pluginDebug.inspectPort}`);
        }

        args.push(
            path.join(__dirname, 'electron', 'electron-plugin-remote.js'),
            '--', 'child', this.pluginId);

        const bin = args.shift();
        this.worker = child_process.spawn(bin, args, {
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            env: Object.assign({}, process.env, env),
            serialization: 'advanced',
        });

        this.worker.on('exit', () => {
        });

        if (options?.pluginDebug?.waitDebug) {
            options.pluginDebug.waitDebug.catch(() => { });
            options.pluginDebug.waitDebug = Promise.resolve(undefined);
        }

        this.worker.send({
            pluginId,
            options: {
                ...options,
                pluginDebug: options?.pluginDebug ? {
                    ...options.pluginDebug,
                    // dont want to send/serialize this.
                    waitDebug: null,
                }: undefined,
            },
        });

        this.setupWorker();
    }

    kill(): void {
        super.kill();
        if (this.worker)
            ElectronForkWorker.allocatedDisplays.delete(this.allocatedDisplay);
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
        peer.addSerializer(net.Socket, net.Socket.name, new SidebandSocketSerializer());
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

    get pid() {
        return this.worker?.pid;
    }
}
