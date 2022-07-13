import { RuntimeWorkerOptions as RuntimeWorkerOptions } from "./runtime-worker";
import child_process from 'child_process';
import path from 'path';
import { RpcMessage, RpcPeer } from "../../rpc";
import { ChildProcessWorker } from "./child-process-worker";
import { getPluginNodePath } from "../plugin-npm-dependencies";
import { SidebandSocketSerializer } from "../socket-serializer";
import net from "net";

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
            env: Object.assign({}, process.env, env, {
                NODE_PATH: path.join(getPluginNodePath(this.pluginId), 'node_modules'),
            }),
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
        peer.addSerializer(net.Socket, net.Socket.name, new SidebandSocketSerializer());
    }

    send(message: RpcMessage, reject?: (e: Error) => void, serializationContext?: any): void {
        try {
            if (!this.worker)
                throw new Error('worked has been killed');
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
        return this.worker.pid;
    }
}
