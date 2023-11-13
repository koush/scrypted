export class BufferedBuffer {
    _buf: Buffer
    _ctrl: string
    _closed: boolean
    _resolve: Function

    constructor() {
        this._buf = Buffer.alloc(0);
    }

    mayResolve() {
        if (this._closed && this._resolve) {
            this._resolve(null);
            this._resolve = null;
            return;
        }
        if (this._resolve && this._ctrl) {
            this._resolve(this._ctrl);
            this._resolve = null;
            this._ctrl = null;
            return;
        }
        if (!this._resolve || this._buf.length == 0) {
            return;
        }
        const b = this._buf;
        this._buf = Buffer.alloc(0);
        this._resolve(b);
        this._resolve = null;
    }

    append(data: Buffer | string) {
        if (Buffer.isBuffer(data)) {
            this._buf = Buffer.concat([this._buf, data]);
        } else {
            this._ctrl = data as string;
        }
        this.mayResolve();
    }

    close() {
        this._closed = true;
        this.mayResolve();
    }

    getOrWait(): Promise<Buffer> {
        return new Promise(resolve => {
            this._resolve = resolve;
            this.mayResolve();
        });
    }

    async *generator(): AsyncGenerator<Buffer, void> {
        while (!this._closed) {
            yield this.getOrWait();
        }
    }
}
