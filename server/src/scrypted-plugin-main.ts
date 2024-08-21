import net from 'net';
import worker_threads from "worker_threads";
import { getPluginNodePath } from "./plugin/plugin-npm-dependencies";
import { startPluginRemote } from "./plugin/plugin-remote-worker";
import { SidebandSocketSerializer } from "./plugin/socket-serializer";
import { RpcMessage } from "./rpc";
import { NodeThreadWorker } from './plugin/runtime/node-thread-worker';

function start(mainFilename: string) {
    const pluginId = process.argv[3];
    module.paths.push(getPluginNodePath(pluginId));

    if (process.argv[2] === 'child-thread') {
        console.log('starting thread', pluginId);
        const { port } = worker_threads.workerData as { port: worker_threads.MessagePort };
        const peer = startPluginRemote(mainFilename, pluginId, (message, reject, serializationContext) => NodeThreadWorker.send(message, port, reject, serializationContext));
        NodeThreadWorker.setupRpcPeer(peer, port);
        port.on('messageerror', e => {
            console.error('message error', e);
            process.exit(1);
        });
        port.on('close', () => {
            console.error('port closed');
            process.exit(1);
        });
    }
    else {
        console.log('starting plugin', pluginId);
        const peer = startPluginRemote(mainFilename, process.argv[3], (message, reject, serializationContext) => process.send(message, serializationContext?.sendHandle, {
            // what happened to this argument?
            // swallowErrors: !reject,
        }, e => {
            if (e)
                reject?.(e);
        }));

        peer.transportSafeArgumentTypes.add(Buffer.name);
        peer.transportSafeArgumentTypes.add(Uint8Array.name);
        peer.addSerializer(net.Socket, net.Socket.name, new SidebandSocketSerializer());
        process.on('message', message => peer.handleMessage(message as RpcMessage));
        process.on('disconnect', () => {
            console.error('peer host disconnected, exiting.');
            process.exit(1);
        });
    }
}

export default start;
