import net from 'net';
import v8 from 'v8';
import worker_threads from "worker_threads";
import { getPluginNodePath } from "./plugin/plugin-npm-dependencies";
import { startPluginRemote } from "./plugin/plugin-remote-worker";
import { SidebandSocketSerializer } from "./plugin/socket-serializer";
import { RpcMessage } from "./rpc";

function start(mainFilename: string) {
    const pluginId = process.argv[3];
    console.log('starting plugin', pluginId);
    module.paths.push(getPluginNodePath(pluginId));

    if (process.argv[2] === 'child-thread') {
        const peer = startPluginRemote(mainFilename, process.argv[3], (message, reject) => {
            try {
                worker_threads.parentPort.postMessage(v8.serialize(message));
            }
            catch (e) {
                reject?.(e);
            }
        });
        peer.transportSafeArgumentTypes.add(Buffer.name);
        peer.transportSafeArgumentTypes.add(Uint8Array.name);
        worker_threads.parentPort.on('message', message => peer.handleMessage(v8.deserialize(message)));
    }
    else {
        const peer = startPluginRemote(mainFilename, process.argv[3], (message, reject, serializationContext) => process.send(message, serializationContext?.sendHandle, {
            swallowErrors: !reject,
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
