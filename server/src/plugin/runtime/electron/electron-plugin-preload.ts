import { startPluginRemote } from "../../plugin-remote-worker";
import { ipcRenderer } from 'electron';
// import { bufferWrapUint8Array } from "./buffer-wrap";
// import { setNpmExecFunctionElectron } from "./set-npm-exec";
import { PassThrough } from "stream";
import { Console } from "console";
import type { RuntimeWorkerOptions } from "../runtime-worker";

// setNpmExecFunctionElectron();

ipcRenderer.on('scrypted-init', (e, initMessage: { pluginId: string, options: RuntimeWorkerOptions }) => {
    const { pluginId, options } = initMessage;

    for (const [k, v] of Object.entries(options.env || {})) {
        process.env[k] = v?.toString();
    }

    const originalConsole = console;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stdout.on('data', d => {
        originalConsole.log(d.toString());
        ipcRenderer.send('scrypted-stdout', d);
    });
    stderr.on('data', d => {
        originalConsole.error(d.toString())
        ipcRenderer.send('scrypted-stderr', d);
    });
    const pluginConsole = new Console(stdout, stderr);
    (globalThis as any).foo = 3;
    global.console = pluginConsole;
    (global as any).ss = originalConsole;

    const peer = startPluginRemote('', pluginId, (message, reject, serializationContext) => {
        try {
            ipcRenderer.send('scrypted', message);
        }
        catch (e) {
            reject?.(e);
        }
    });

    // const evalLocal = peer.evalLocal.bind(peer);
    // peer.evalLocal = (script, filename, params) => {
    //     // at some point vscode or chromes source map pathing got confused by
    //     // file paths and no longer mapped them. by using a custom protocol,
    //     // the source map paths get properly resolved.
    //     return evalLocal(script, `scrypted-electron://${filename}`, params);
    // }

    peer.transportSafeArgumentTypes.add(Buffer.name);
    peer.transportSafeArgumentTypes.add(Uint8Array.name);

    // const deserialize = peer.deserialize;
    // peer.deserialize = (value, deserializationContext) => {
    //     const ret = deserialize.call(peer, value, deserializationContext);
    //     if (ret instanceof Uint8Array)
    //         return bufferWrapUint8Array(ret);
    //     return ret;
    // }

    ipcRenderer.on('scrypted', (_, data) => {
        peer.handleMessage(data);
    })
});

