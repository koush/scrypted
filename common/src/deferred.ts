export class Deferred<T> {
    finished = false;
    resolve!: (value: T) => this;
    reject!: (error: Error) => this;
    async resolvePromise(p: Promise<T>) {
        try {
            this.resolve(await p);
        }
        catch (e) {
            this.reject(e as Error);
        }
    }
    promise = new Promise<T>((resolve, reject) => {
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
