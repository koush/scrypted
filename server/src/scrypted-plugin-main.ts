import { startPluginRemote } from "./plugin/plugin-remote-worker";
import { RpcMessage } from "./rpc";
import worker_threads from "worker_threads";
import v8 from 'v8';

if (process.argv[2] === 'child-thread') {
    const peer = startPluginRemote(process.argv[3], (message, reject) => {
        try {
            worker_threads.parentPort.postMessage(v8.serialize(message));
        }
        catch (e) {
            reject?.(e);
        }
    });
    peer.transportSafeArgumentTypes.add(Buffer.name);
    worker_threads.parentPort.on('message', message => peer.handleMessage(v8.deserialize(message)));
}
else {
    const peer = startPluginRemote(process.argv[3], (message, reject) => process.send(message, undefined, {
        swallowErrors: !reject,
    }, e => {
        if (e)
            reject?.(e);
    }));

    peer.transportSafeArgumentTypes.add(Buffer.name);
    process.on('message', message => peer.handleMessage(message as RpcMessage));
    process.on('disconnect', () => {
        console.error('peer host disconnected, exiting.');
        process.exit(1);
    });
}
