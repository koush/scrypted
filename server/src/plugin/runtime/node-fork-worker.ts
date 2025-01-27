import child_process from 'child_process';
import net from "net";
import path from 'path';
import { getScryptedClusterMode } from '../../cluster/cluster-setup';
import { RpcMessage, RpcPeer } from "../../rpc";
import { SidebandSocketSerializer } from "../socket-serializer";
import { ChildProcessWorker } from "./child-process-worker";
import { RuntimeWorkerOptions } from "./runtime-worker";

export const NODE_PLUGIN_CHILD_PROCESS = 'child';
export const NODE_PLUGIN_FORK_PROCESS = 'fork';
export const NODE_PLUGIN_THREAD_PROCESS = 'child-thread';

export function isNodePluginWorkerProcess() {
    return isNodePluginChildProcess() || isNodePluginForkProcess() || isNodePluginThreadProcess();
}

export function isNodePluginForkProcess() {
    return process.argv[2] === NODE_PLUGIN_FORK_PROCESS;
}

export function isNodePluginThreadProcess() {
    return process.argv[2] === NODE_PLUGIN_THREAD_PROCESS;
}

export function isNodePluginChildProcess() {
    return process.argv[2] === NODE_PLUGIN_CHILD_PROCESS;
}

export class NodeForkWorker extends ChildProcessWorker {

    constructor(mainFilename: string, options: RuntimeWorkerOptions) {
        super(options);

        const { env, pluginDebug } = options;

        // execArgv will contain the inspect port when debugging the main plugin process.
        // remove that argument to prevent a plugin fork from trying to listen on that port again.
        const execArgv: string[] = process.execArgv.slice().filter(arg => !arg.startsWith('--inspect='));
        if (pluginDebug) {
            execArgv.push(`--inspect=0.0.0.0:${pluginDebug.inspectPort}`);
        }

        const args = [
            // change the argument marker depending on whether this is the main scrypted server process
            // starting a plugin vs the plugin forking for multiprocessing.
            isNodePluginWorkerProcess() || getScryptedClusterMode()?.[0] === 'client' ? NODE_PLUGIN_FORK_PROCESS : NODE_PLUGIN_CHILD_PROCESS,
            this.pluginId
        ];

        const nodePaths: string[] = [
            // /server/node_modules/@scrypted/server/node_modules
            path.resolve(__dirname, '..', '..', '..', 'node_modules'),
            // /server/node_modules
            path.resolve(process.cwd(), 'node_modules'),
        ];
        if (env?.NODE_PATH)
            nodePaths.push(env.NODE_PATH);
        if (process.env.NODE_PATH)
            nodePaths.push(process.env.NODE_PATH);

        this.worker = child_process.fork(mainFilename, args, {
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            env: Object.assign({}, process.env, env,
                {
                    NODE_PATH: nodePaths.join(path.delimiter),
                }
            ),
            serialization: 'advanced',
            execArgv,
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
