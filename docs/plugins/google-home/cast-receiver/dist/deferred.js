export class Deferred {
    finished = false;
    resolve;
    reject;
    promise = new Promise((resolve, reject) => {
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
//# sourceMappingURL=deferred.js.map