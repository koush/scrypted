import sdk, { ForkOptions, PluginFork } from '@scrypted/sdk';
import { createAsyncQueue } from './async-queue';
import os from 'os';

export type Zygote<T> = () => PluginFork<T>;

export function createService<T, V>(options: ForkOptions, create: (t: Promise<T>) => Promise<V>): {
    getResult: () => Promise<V>,
    terminate: () => void,
} {
    let killed = false;
    let currentResult: Promise<V>;
    let currentFork: ReturnType<typeof sdk.fork<T>>;

    return {
        getResult() {
            if (killed)
                throw new Error('service terminated');

            if (currentResult)
                return currentResult;

            currentFork = sdk.fork<T>(options);
            currentFork.worker.on('exit', () => currentResult = undefined);
            currentResult = create(currentFork.result);
            currentResult.catch(() => {
                currentResult = undefined;
            });
            return currentResult;
        },

        terminate() {
            if (killed)
                return;

            killed = true;
            currentFork.worker.terminate();
            currentFork = undefined;
            currentResult = undefined;
        }
    }
}

export function createZygote<T>(options?: ForkOptions): Zygote<T> {
    let zygote = sdk.fork<T>(options);
    function* next() {
        while (true) {
            const cur = zygote;
            zygote = sdk.fork<T>(options);
            yield cur;
        }
    }

    const gen = next();
    return () => gen.next().value as PluginFork<T>;
}


export function createZygoteWorkQueue<T>(maxWorkers: number = os.cpus().length >> 1) {
    const queue = createAsyncQueue<(doWork: (fork: PluginFork<T>) => Promise<any>) => Promise<any>>();
    let forks = 0;

    return async <R>(doWork: (fork: PluginFork<T>) => Promise<R>): Promise<R> => {
        const check = queue.take();
        if (check)
            return check(doWork);

        if (maxWorkers && forks < maxWorkers) {
            let exited = false;
            const controller = new AbortController();
            // necessary to prevent unhandledrejection errors
            controller.signal.addEventListener('abort', () => { });
            const fork = sdk.fork<T>();
            forks++;
            fork.worker.on('exit', () => {
                forks--;
                exited = true;
                controller.abort();
            });

            let timeout: NodeJS.Timeout;
            const queueFork = () => {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    // keep one alive.
                    if (forks === 1)
                        return;
                    fork.worker.terminate();
                }, 30000);

                queue.submit(async v2 => {
                    clearTimeout(timeout);
                    try {
                        return await v2(fork);
                    }
                    finally {
                        if (!exited) {
                            queueFork();
                        }
                    }
                }, controller.signal);
            }

            queueFork();
        }

        const d = await queue.dequeue();
        return d(doWork);
    };
}
