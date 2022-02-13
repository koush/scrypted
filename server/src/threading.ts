import worker_threads from 'worker_threads';
import { getEvalSource, RpcPeer } from './rpc';
import v8 from 'v8';

export async function newThread<T>(thread: () => Promise<T>): Promise<T>;
export async function newThread<V, T>(params: V, thread: (params: V) => Promise<T>): Promise<T>;

export async function newThread<T>(...args: any[]): Promise<T> {
    let thread: () => Promise<T> = args[1];
    let params: { [key: string]: any } = {};
    if (thread) {
        params = args[0];
    }
    else {
        thread = args[0];
    }

    const m = (customRequire: string, RpcPeer: any) => {
        if (customRequire) {
            const g = global as any;
            g[customRequire] = g.require;
        }
        const v8 = global.require('v8');
        const worker_threads = global.require('worker_threads');
        const vm = global.require('vm');
        const mainPeer = new RpcPeer('thread', 'main', (message: any, reject: any) => {
            try {
                worker_threads.parentPort.postMessage(v8.serialize(message));
            }
            catch (e) {
                reject?.(e);
            }
        });
        worker_threads.parentPort.on('message', (message: any) => mainPeer.handleMessage(v8.deserialize(message)));

        mainPeer.params.eval = async (script: string, paramNames: string[], ...paramValues: any[]) => {
            const f = vm.compileFunction(`return (${script})`, paramNames, {
                filename: 'script.js',
            });
            const params: any = {};
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
    worker.on('message', (message: any) => threadPeer.handleMessage(v8.deserialize(message)));

    const e = await threadPeer.getParam('eval');
    const paramNames = Object.keys(params);
    const paramValues = Object.values(params);
    try {
        return await e(thread.toString(), paramNames, ...paramValues);
    }
    finally {
        worker.terminate();
    }
}

async function test() {
    const foo = 5;
    const bar = 6;

    console.log(await newThread({
        foo, bar,
    }, async () => {
        return foo + bar;
    }));


    console.log(await newThread({
        foo, bar,
    }, async ({foo,bar}) => {
        return foo + bar;
    }));

    const sayHelloInMainThread = () => console.log('hello! main thread:', worker_threads.isMainThread);
    await newThread({
        sayHelloInMainThread,
    }, async () => {
        sayHelloInMainThread();
    })
}

// if (true)
//     test();
