export interface RefreshPromise<T> {
    promise: Promise<T>;
    cacheDuration: number;
}

export function singletonPromise<T>(rp: RefreshPromise<T>, method: () => Promise<T>, cacheDuration = 0) {
    if (rp?.promise)
        return rp;

    const promise = method();
    if (!rp) {
        rp = {
            promise,
            cacheDuration,
        }
    }
    else {
        rp.promise = promise;
    }
    promise.finally(() => setTimeout(() => rp.promise = undefined, rp.cacheDuration));
    return rp;
}

export class TimeoutError extends Error {
    constructor(public promise: Promise<any>) {
        super('Operation Timed Out');
    }
}

export function timeoutPromise<T>(timeout: number, promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        setTimeout(() => reject(new TimeoutError(promise)), timeout);

        const t = setTimeout(() => reject(new TimeoutError(promise)), timeout);

        promise.then(v => {
            clearTimeout(t);
            resolve(v);
        });

        promise.catch(e => {
            clearTimeout(t);
            reject(e);
        });
    })
}

export function timeoutFunction<T>(timeout: number, f: (isTimedOut: () => boolean) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let isTimedOut = false;
        const promise = f(() => isTimedOut);

        const t = setTimeout(() => {
            isTimedOut = true;
            reject(new TimeoutError(promise));
        }, timeout);

        promise.then(v => {
            clearTimeout(t);
            resolve(v);
        });

        promise.catch(e => {
            clearTimeout(t);
            reject(e);
        });
    })
}
