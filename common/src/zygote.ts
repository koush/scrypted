import sdk, { PluginFork } from '@scrypted/sdk';
import worker_threads from 'worker_threads';

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
