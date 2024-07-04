export interface RefreshPromise<T> {
    promise: Promise<T>;
    cacheDuration: number;
}

export function singletonPromise<T>(rp: undefined | RefreshPromise<T>, method: () => Promise<T>, cacheDuration = 0) {
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

export class TimeoutError<T> extends Error {
    constructor(public promise: Promise<T>) {
        super('Operation Timed Out');
    }
}

export function timeoutPromise<T>(timeout: number, promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new TimeoutError(promise)), timeout);

        promise
            .then(v => {
                clearTimeout(t);
                resolve(v);
            })
            .catch(e => {
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

        promise
            .then(v => {
                clearTimeout(t);
                resolve(v);
            })
            .catch(e => {
                clearTimeout(t);
                reject(e);
            });
    })
}

export function createPromiseDebouncer<T>() {
    let current: Promise<T>;

    return (func: () => Promise<T>): Promise<T> => {
        if (!current)
            current = func().finally(() => current = undefined);
        return current;
    }
}

export function createMapPromiseDebouncer<T>() {
    const map = new Map<string, Promise<T>>();

    return (key: any, debounce: number, func: () => Promise<T>): Promise<T> => {
        const keyStr = JSON.stringify(key);
        let value = map.get(keyStr);
        if (!value) {
            value = func().finally(() => {
                if (!debounce) {
                    map.delete(keyStr);
                    return;
                }
                setTimeout(() => map.delete(keyStr), debounce);
            });
            map.set(keyStr, value);
        }
        return value;
    }
}
