// Type definitions for abstract-leveldown 5.0
// Project: https://github.com/Level/abstract-leveldown
// Definitions by: Meirion Hughes <https://github.com/MeirionHughes>
//                 Daniel Byrne <https://github.com/danwbyrne>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped
// TypeScript Version: 2.3

import { asyncFilter } from "./asynciterable-utils";

export interface AbstractOptions {
    // wtf is this?
    readonly [k: string]: any;
}

export type ErrorCallback = (err: Error | undefined) => void;
export type ErrorValueCallback<V> = (err: Error | undefined, value: V) => void;
export type ErrorKeyValueCallback<K, V> = (err: Error | undefined, key: K, value: V) => void;

export interface AbstractOpenOptions extends AbstractOptions {
    createIfMissing?: boolean;
    errorIfExists?: boolean;
}

export interface AbstractGetOptions extends AbstractOptions {
    asBuffer?: boolean;
}

export interface LevelDocument {
    _id?: any;
    _documentType?: string;
}

export interface LevelDocumentConstructor<T extends LevelDocument> {
    new(): T;
}

export interface AbstractLevelDOWN<K = any, V = any> /* extends AbstractOptions */ {
    open(cb?: ErrorCallback): Promise<void>;
    open(options: AbstractOpenOptions, cb?: ErrorCallback): Promise<void>;

    close(cb?: ErrorCallback): void;

    get(key: K, cb?: ErrorValueCallback<V>): Promise<V>;
    get(key: K, options: AbstractGetOptions, cb?: ErrorValueCallback<V>): Promise<V>;

    put(key: K, value: V, cb?: ErrorCallback): Promise<void>;
    put(key: K, value: V, options: AbstractOptions, cb?: ErrorCallback): Promise<void>;

    del(key: K, cb?: ErrorCallback): Promise<void>;
    del(key: K, options: AbstractOptions, cb?: ErrorCallback): Promise<void>;

    batch(): AbstractChainedBatch<K, V>;
    batch(array: ReadonlyArray<AbstractBatch<K, V>>, cb?: ErrorCallback): AbstractChainedBatch<K, V>;
    batch(
        array: ReadonlyArray<AbstractBatch<K, V>>,
        options: AbstractOptions,
        cb?: ErrorCallback,
    ): AbstractChainedBatch<K, V>;

    iterator(options?: AbstractIteratorOptions<K>): AbstractIterator<K, V>;

    [Symbol.asyncIterator](): AsyncIterator<{ key: K, value: V }>;
    nextId(): number;
    tryGet<T extends LevelDocument>(documentConstructor: LevelDocumentConstructor<T>, _id: any, options?: AbstractGetOptions): Promise<T | undefined>;
    getAll<T extends LevelDocument>(documentConstructor: LevelDocumentConstructor<T>, options?: AbstractGetOptions): AsyncIterable<T>;
    upsert<T extends LevelDocument>(value: T, options?: AbstractOptions): Promise<T>;
    remove<T extends LevelDocument>(value: T): Promise<void>;
    removeId<T extends LevelDocument>(documentConstructor: LevelDocumentConstructor<T>, _id: any): Promise<void>;
    removeAll<T extends LevelDocument>(documentConstructor: LevelDocumentConstructor<T>): Promise<void>;
    getCount<T extends LevelDocument>(documentConstructor: LevelDocumentConstructor<T>, options?: AbstractGetOptions): Promise<number>;
}

export interface AbstractLevelDOWNConstructor {
    // tslint:disable-next-line no-unnecessary-generics
    new <K = any, V = any>(location: string): AbstractLevelDOWN<K, V>;
    // tslint:disable-next-line no-unnecessary-generics
    <K = any, V = any>(location: string): AbstractLevelDOWN<K, V>;
}

export interface AbstractIteratorOptions<K = any> extends AbstractOptions {
    gt?: K;
    gte?: K;
    lt?: K;
    lte?: K;
    reverse?: boolean;
    limit?: number;
    keys?: boolean;
    values?: boolean;
    keyAsBuffer?: boolean;
    valueAsBuffer?: boolean;
}

export type AbstractBatch<K = any, V = any> = PutBatch<K, V> | DelBatch<K, V>;

export interface PutBatch<K = any, V = any> {
    readonly type: 'put';
    readonly key: K;
    readonly value: V;
}

export interface DelBatch<K = any, V = any> {
    readonly type: 'del';
    readonly key: K;
}

export interface AbstractChainedBatch<K = any, V = any> extends AbstractOptions {
    put: (key: K, value: V) => this;
    del: (key: K) => this;
    clear: () => this;
    write(cb?: ErrorCallback): any;
    write(options: any, cb?: ErrorCallback): any;
}

export interface AbstractChainedBatchConstructor {
    // tslint:disable-next-line no-unnecessary-generics
    new <K = any, V = any>(db: any): AbstractChainedBatch<K, V>;
    // tslint:disable-next-line no-unnecessary-generics
    <K = any, V = any>(db: any): AbstractChainedBatch<K, V>;
}

export interface AbstractIterator<K, V> extends AbstractOptions {
    db: AbstractLevelDOWN<K, V>;
    next(cb?: ErrorKeyValueCallback<K, V>): this;
    end(cb?: ErrorCallback): void;
}

export interface AbstractIteratorConstructor {
    // tslint:disable-next-line no-unnecessary-generics
    new <K = any, V = any>(db: any): AbstractIterator<K, V>;
    // tslint:disable-next-line no-unnecessary-generics
    <K = any, V = any>(db: any): AbstractIterator<K, V>;
}

export interface Level extends AbstractLevelDOWN {
    readonly location: string;
    readonly prefix: string;
    readonly version: string | number;
    destroy(location: string, cb?: (err: Error | undefined) => void): void;
    destroy(location: string, prefix: string, cb?: (err: Error | undefined) => void): void;
}

interface LevelOptions {
    readonly prefix?: string;
    readonly version?: string | number;
}


interface LevelConstructor {
    new(location: string, options?: LevelOptions): Level;
    (location: string, options?: LevelOptions): Level;
}

declare const Level: LevelConstructor;

const level = require('level') as LevelConstructor;

function createLevelDocument(documentConstructor: any, json: any) {
    const doc = new documentConstructor();
    Object.assign(doc, JSON.parse(json));
    return doc;
}

const wrapped = (location: string, options?: LevelOptions) => {
    const ret = level(location, options);
    ret.tryGet = async (documentConstructor: any, _id: any, options?: AbstractGetOptions): Promise<any> => {
        try {
            const _documentType = documentConstructor.name;
            const key = `${_documentType}/${_id}`;
            const json = await ret.get(key, options);
            return createLevelDocument(documentConstructor, json);
        }
        catch (e) {
        }
    }

    const iterable = {
        async*[Symbol.asyncIterator]() {
            const iterator = ret.iterator();
            try {
                while (true) {
                    const { key, value } = await new Promise((resolve, reject) => {
                        iterator.next((err, key, value) => {
                            if (err) {
                                reject(err);
                            }
                            else {
                                resolve({ key, value });
                            }
                        })
                    });

                    if (key == null && value == null)
                        break;
                    yield {
                        key,
                        value,
                    }
                }
            }
            finally {
                await new Promise(resolve => iterator.end(resolve));
            }
        }
    };

    ret[Symbol.asyncIterator] = iterable[Symbol.asyncIterator] as any;
    ret.getAll = (documentConstructor: any, options?: AbstractGetOptions): AsyncIterable<any> => {
        const _documentType = documentConstructor.name;
        const prefix = `${_documentType}/`;
        return {
            async*[Symbol.asyncIterator]() {
                for await (const entry of ret) {
                    if (entry.key.startsWith(prefix)) {
                        const doc = createLevelDocument(documentConstructor, entry.value);
                        if (doc._documentType === _documentType) {
                            yield doc;
                        }
                    }
                }
            }
        }
    }

    ret.getCount = async (documentConstructor: any, options?: AbstractGetOptions): Promise<any> => {
        let count = 0;
        for await (const doc of ret.getAll(documentConstructor)) {
            count++;
        }
        return count;
    }

    let curId: number;

    const oldOpen = ret.open.bind(ret);
    (ret as any).open = async (...args: any) => {
        curId = parseInt(await ret.get('_id'));
        if (curId === NaN)
            curId = 0;
        return oldOpen(...args);
    }

    ret.nextId = () => {
        if (typeof curId !== 'number')
            throw new Error('curId is not a number');
        return ++curId;
    }

    const saveId = async () => {
        return ret.put("_id", curId);
    }

    ret.upsert = async (value: LevelDocument, options?: AbstractOptions): Promise<any> => {
        const _documentType = value.constructor.name;
        if (!value._id)
            value._id = ret.nextId();

        await saveId();

        value._documentType = _documentType;
        const key = `${_documentType}/${value._id}`;
        await ret.put(key, JSON.stringify(value), options);
        return value;
    };

    ret.remove = async (value: LevelDocument) => {
        const _documentType = value.constructor.name;
        let { _id } = value;
        const key = `${_documentType}/${_id}`;
        await ret.del(key);
    }

    ret.removeId = async (documentConstructor: LevelDocumentConstructor<any>, _id: any) => {
        const _documentType = documentConstructor.name;
        const key = `${_documentType}/${_id}`;
        await ret.del(key);
    }

    ret.removeAll = async (documentConstructor: LevelDocumentConstructor<any>) => {
        const _documentType = documentConstructor.name;
        const prefix = `${_documentType}/`;
        for await (const entry of ret) {
            if (entry.key.startsWith(prefix)) {
                const doc = createLevelDocument(documentConstructor, entry.value);
                if (doc._documentType === _documentType) {
                    await ret.del(entry.key);
                }
            }
        }
    }

    return ret;
};

export default wrapped as LevelConstructor;
