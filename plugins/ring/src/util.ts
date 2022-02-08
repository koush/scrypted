export interface RefreshPromise<T> {
    promise: Promise<T>;
    cacheDuration: number;
}

export function singletonPromise<T>(rp: RefreshPromise<T>, method: () => Promise<T>) {
    if (rp?.promise)
        return rp;

    const promise = method();
    if (!rp) {
        rp = {
            promise,
            cacheDuration: 0,
        }
    }
    else {
        rp.promise = promise;
    }
    promise.finally(() => setTimeout(() => rp.promise = undefined, rp.cacheDuration));
    return rp;
}

export function timeoutPromise<T>(timeout: number, promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        setTimeout(() => reject(new Error('timed out')), timeout);
        promise.then(resolve);
        promise.catch(reject);
    })
}
