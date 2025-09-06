export abstract class AsyncUsingHolderBase<T> {
    constructor(private _value: T) {
    }

    get value(): T {
        return this._value;
    }

    async [Symbol.asyncDispose]() {
        await this.release();
    }

    abstract asyncDispose(value: T): Promise<void>;

    detach() {
        const value = this._value;
        this._value = undefined;
        return value;
    }

    async replace(value: T) {
        this.release();
        this._value = value;
    }

    async release() {
        const released = this.detach();
        if (released)
            await this.asyncDispose(released);
    }
}
export abstract class UsingHolderBase<T> {
    constructor(private _value: T) {
    }

    get value(): T {
        return this._value;
    }

    [Symbol.dispose]() {
        this.release();
    }

    abstract dispose(value: T): void;

    detach() {
        const value = this._value;
        this._value = undefined;
        return value;
    }

    replace(value: T) {
        this.release();
        this._value = value;
    }

    release() {
        const released = this.detach();
        if (released)
            this.dispose(released);
    }
}

export class UsingHolder<T extends Disposable> extends UsingHolderBase<T> {
    dispose(value: T) {
        value?.[Symbol.dispose]();
    }

    transferClosure<V>(closure: (value: UsingHolder<T>) => Promise<V>) {
        return (async () => {
            using attached = new UsingHolder(this.detach());
            return await closure(attached);
        })();
    }
}

export class AsyncUsingHolder<T extends AsyncDisposable> extends AsyncUsingHolderBase<T> {
    async asyncDispose(value: T) {
        value?.[Symbol.asyncDispose]();
    }

    transferClosure<V>(closure: (value: AsyncUsingHolder<T>) => Promise<V>) {
        return (async () => {
            await using attached = new AsyncUsingHolder(this.detach());
            return await closure(attached);
        })();
    }
}

export class DisposableHolder<T> extends UsingHolderBase<T> {
    constructor(value: T, private _dispose: (value: T) => void) {
        super(value);
    }

    dispose(value: T) {
        this._dispose(value);
    }
}
