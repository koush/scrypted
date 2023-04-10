export class Deferred<T> {
    finished = false;
    resolve!: (value: T|PromiseLike<T>) => this;
    reject!: (error: Error) => this;
    promise: Promise<T> = new Promise((resolve, reject) => {
        this.resolve = v => {
            this.finished = true;
            resolve(v);
            return this;
        };
        this.reject = e => {
            this.finished = true;
            reject(e);
            return this;
        };
    });
}
