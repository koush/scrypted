import sdk, { PluginFork } from '@scrypted/sdk';
import worker_threads from 'worker_threads';
import { createAsyncQueue } from './async-queue';

export type Zygote<T> = () => PluginFork<T>;

export function createZygote<T>(): Zygote<T> {
    if (!worker_threads.isMainThread)
        return;

    let zygote = sdk.fork<T>();
    function* next() {
        while (true) {
            const cur = zygote;
            zygote = sdk.fork<T>();
            yield cur;
        }
    }

    const gen = next();
    return () => gen.next().value as PluginFork<T>;
}


export function createZygoteWorkQueue<T>() {
    const queue = createAsyncQueue<(doWork: (fork: PluginFork<T>) => Promise<any>) => Promise<any>>();
    let forks = 0;

    return async <R>(doWork: (fork: PluginFork<T>) => Promise<R>): Promise<R> => {
        const check = queue.take();
        if (check)
            return check(doWork);

        let exited = false;
        const controller = new AbortController();
        // necessary to prevent unhandledrejection errors
        controller.signal.addEventListener('abort', () => {});
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

        const d = await queue.dequeue();
        return d(doWork);
    };
}
