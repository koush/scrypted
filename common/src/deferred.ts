export class Deferred<T> {
    finished = false;
    resolve!: (value: T) => void;
    reject!: (error: Error) => void;
    promise: Promise<T> = new Promise((resolve, reject) => {
        this.resolve = v => {
            this.finished = true;
            resolve(v);
        };
        this.reject = e => {
            this.finished = true;
            reject(e);
        };
    });
}
