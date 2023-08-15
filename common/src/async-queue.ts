import { Deferred } from "./deferred";

class EndError extends Error {
}

export function createAsyncQueue<T>() {
    let ended: Error | undefined;
    const waiting: Deferred<T>[] = [];
    const queued: { item: T, dequeued?: Deferred<void> }[] = [];

    const dequeue = async () => {
        if (queued.length) {
            const { item, dequeued: enqueue } = queued.shift()!;
            enqueue?.resolve();
            return item;
        }

        if (ended)
            throw ended;

        const deferred = new Deferred<T>();
        waiting.push(deferred);
        return deferred.promise;
    }

    const submit = (item: T, dequeued?: Deferred<void>, signal?: AbortSignal) => {
        if (ended)
            return false;

        if (waiting.length) {
            const deferred = waiting.shift();
            dequeued?.resolve();
            deferred.resolve(item);
            return true;
        }

        const qi = {
            item,
            dequeued,
        };
        queued!.push(qi);

        signal?.addEventListener('abort', () => {
            const index = queued.indexOf(qi);
            if (index === -1)
                return;
            queued.splice(index, 1);
            dequeued?.reject(new Error('abort'));
        });

        return true;
    }

    function queue() {
        return (async function* () {
            while (true) {
                try {
                    const item = await dequeue();
                    yield item;
                }
                catch (e) {
                    if (e instanceof EndError)
                        return;
                    throw e;
                }
            }
        })();
    }

    function clear(error?: Error) {
        const ret: T[] = [];
        const items = queued.splice(0, queued.length);
        for (const item of items) {
            if (error)
                item.dequeued?.reject(error)
            else
                item.dequeued?.resolve(undefined);
            ret.push(item.item);
        }

        return ret;
    }

    return {
        clear() {
            return clear();
        },
        queued,
        async pipe(callback: (i: T) => void) {
            for await (const i of queue()) {
                callback(i as any);
            }
        },
        submit(item: T, signal?: AbortSignal) {
            return submit(item, undefined, signal);
        },
        end(e?: Error) {
            if (ended)
                return false;
            // catch to prevent unhandled rejection.
            ended = e || new EndError()
            clear(e);
            return true;
        },
        async enqueue(item: T, signal?: AbortSignal) {
            const dequeued = new Deferred<void>();
            if (!submit(item, dequeued, signal))
                return false;
            await dequeued.promise;
            return true;
        },
        dequeue,
        get queue() {
            return queue();
        }
    }
}

// async function testSlowEnqueue() {
//     const asyncQueue = createAsyncQueue<number>();

//     asyncQueue.submit(-1);
//     asyncQueue.submit(-1);
//     asyncQueue.submit(-1);
//     asyncQueue.submit(-1);

//     (async () => {
//         console.log('go');
//         for (let i = 0; i < 10; i++) {
//             asyncQueue.submit(i);
//             await sleep(100);
//         }
//         asyncQueue.end(new Error('fail'));
//     })();


//     const runQueue = async (str?: string) => {
//         for await (const n of asyncQueue.queue) {
//             console.log(str, n);
//         }
//     }

//     runQueue('start');

//     setTimeout(runQueue, 400);
// }



// async function testSlowDequeue() {
//     const asyncQueue = createAsyncQueue<number>();

//     const runQueue = async (str?: string) => {
//         for await (const n of asyncQueue.queue) {
//             await sleep(100);
//         }
//     }

//     runQueue()
//     .catch(e => console.error('queue threw', e));

//     console.log('go');
//     for (let i = 0; i < 10; i++) {
//         console.log(await asyncQueue.enqueue(i));
//         console.log(i);
//     }
//     asyncQueue.end(new Error('fail'));
//     console.log(await asyncQueue.enqueue(555));
// }

// testSlowDequeue();
