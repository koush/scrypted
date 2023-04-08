// WARNING: threading.ts does not work because RpcPeer transpilation does not include readonly static properties in the class definition

import worker_threads from 'worker_threads';
import { getEvalSource, RpcPeer } from './rpc';
import v8 from 'v8';
import vm from 'vm';

export async function newThread<T>(thread: () => Promise<T>): Promise<T>;
export async function newThread<V, T>(params: V, thread: (params: V) => Promise<T>): Promise<T>;
export async function newThread<M, V, T>(modules: M, params: V, thread: (params: M & V) => Promise<T>): Promise<T>;

export async function newThread<T>(...args: any[]): Promise<T> {
    let params: { [key: string]: any } = {};
    let modules: { [key: string]: any } = {};
    let thread: () => Promise<T>;
    if (args[2]) {
        modules = args[0]
        params = args[1];
        thread = args[2];
    }
    else if (args[1]) {
        params = args[0];
        thread = args[1];
    }
    else {
        thread = args[0];
    }

    const m = (customRequire: string, RpcPeer: any) => {
        if (customRequire) {
            const g = global as any;
            g[customRequire] = g.require;
        }
        const thread_v8: typeof v8 = global.require('v8');
        const thread_worker_threads: typeof worker_threads = global.require('worker_threads');
        const thread_vm: typeof vm = global.require('vm');
        const mainPeer: RpcPeer = new RpcPeer('thread', 'main', (message: any, reject: any) => {
            try {
                thread_worker_threads.parentPort.postMessage(thread_v8.serialize(message));
            }
            catch (e) {
                reject?.(e);
            }
        });
        mainPeer.transportSafeArgumentTypes.add(Buffer.name);
        mainPeer.transportSafeArgumentTypes.add(Uint8Array.name);
        thread_worker_threads.parentPort.on('message', (message: any) => mainPeer.handleMessage(thread_v8.deserialize(message)));

        mainPeer.params.eval = async (script: string, moduleNames: string[], paramNames: string[], ...paramValues: any[]) => {
            const f = thread_vm.compileFunction(`return (${script})`, paramNames, {
                filename: 'script.js',
            });
            const params: any = {};
            for (const module of moduleNames) {
                params[module] = global.require(module);
            }
            for (let i = 0; i < paramNames.length; i++) {
                params[paramNames[i]] = paramValues[i];
            }
            const c = await f(...paramValues);
            return await c(params);
        }
    };
    const rpcSource = getEvalSource();

    let customRequire = params.customRequire || '';

    const workerSource = `
    const {RpcPeer} = ${rpcSource};

    (${m})("${customRequire}", RpcPeer)`;

    const worker = new worker_threads.Worker(workerSource, {
        eval: true,
    });

    const threadPeer = new RpcPeer('main', 'thread', (message, reject) => {
        try {
            worker.postMessage(v8.serialize(message));
        }
        catch (e) {
            reject?.(e);
        }
    });
    threadPeer.transportSafeArgumentTypes.add(Buffer.name);
    threadPeer.transportSafeArgumentTypes.add(Uint8Array.name);
    worker.on('message', (message: any) => threadPeer.handleMessage(v8.deserialize(message)));

    const e = await threadPeer.getParam('eval');
    const moduleNames = Object.keys(modules);
    const paramNames = Object.keys(params);
    const paramValues = Object.values(params);
    try {
        return await e(thread.toString(), moduleNames, paramNames, ...paramValues);
    }
    finally {
        worker.terminate();
    }
}
