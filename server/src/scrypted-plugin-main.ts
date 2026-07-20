import net from 'net';
import worker_threads from "worker_threads";
import { getPluginNodePath } from "./plugin/plugin-npm-dependencies";
import { startPluginRemote } from "./plugin/plugin-remote-worker";
import { SidebandSocketSerializer } from "./plugin/socket-serializer";
import { RpcMessage } from "./rpc";
import { NodeThreadWorker } from './plugin/runtime/node-thread-worker';
import { isNodePluginForkProcess, isNodePluginThreadProcess } from './plugin/runtime/node-fork-worker';

function start(mainFilename: string) {
    const pluginId = process.argv[3]!;
    module.paths.push(getPluginNodePath(pluginId));

    if (isNodePluginThreadProcess()) {
        console.log('starting thread', pluginId, process.pid, worker_threads.threadId);
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
        if (isNodePluginForkProcess())
            console.log('starting fork', pluginId, process.pid);
        else
            console.log('starting plugin', pluginId, process.pid);
        const peer = startPluginRemote(mainFilename, pluginId, (message, reject, serializationContext) => process.send!(message, serializationContext?.sendHandle, {
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

        // Backstop for orphaned workers.
        // The 'disconnect' event above is not reliably delivered when the parent
        // process dies abruptly (SIGKILL/crash): the worker is reparented to init
        // (or a subreaper) and, if something keeps its event loop alive (e.g. a
        // pending timer or socket), it lingers forever. Poll the parent pid and
        // exit when it changes, so an orphaned worker can never leak.
        // unref() so this timer alone never keeps an otherwise-idle worker alive.
        const originalParentPid = process.ppid;
        setInterval(() => {
            if (process.ppid !== originalParentPid) {
                console.error('parent process died (reparented), exiting.');
                process.exit(1);
            }
        }, 10000).unref();
    }
}

export default start;
