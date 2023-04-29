import { startPluginRemote } from "./plugin/plugin-remote-worker";
import { RpcMessage } from "./rpc";
import worker_threads from "worker_threads";
import v8 from 'v8';
import net from 'net';
import { SidebandSocketSerializer } from "./plugin/socket-serializer";

function start(mainFilename: string) {
    if (process.argv[2] === 'child-thread') {
        const ret = startPluginRemote(mainFilename, process.argv[3], (message, reject) => {
            try {
                worker_threads.parentPort.postMessage(v8.serialize(message));
            }
            catch (e) {
                reject?.(e);
            }
        });
        const { peer } = ret;
        peer.transportSafeArgumentTypes.add(Buffer.name);
        peer.transportSafeArgumentTypes.add(Uint8Array.name);
        worker_threads.parentPort.on('message', message => peer.handleMessage(v8.deserialize(message)));
        return ret;
    }
    else {
        const ret = startPluginRemote(mainFilename, process.argv[3], (message, reject, serializationContext) => process.send(message, serializationContext?.sendHandle, {
            swallowErrors: !reject,
        }, e => {
            if (e)
                reject?.(e);
        }));
        const { peer } = ret;

        peer.transportSafeArgumentTypes.add(Buffer.name);
        peer.transportSafeArgumentTypes.add(Uint8Array.name);
        peer.addSerializer(net.Socket, net.Socket.name, new SidebandSocketSerializer());
        process.on('message', message => peer.handleMessage(message as RpcMessage));
        process.on('disconnect', () => {
            console.error('peer host disconnected, exiting.');
            process.exit(1);
        });
        return ret;
    }
}

export default start;
