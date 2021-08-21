export function asyncFilter<T>(asyncIterable: AsyncIterable<T>, predicate: (t: T) => Promise<boolean>): AsyncIterable<T> {
    return {
        async* [Symbol.asyncIterator]() {
            for await (const value of asyncIterable) {
                if (await predicate(value)) {
                    yield value;
                }
            }
        }
    }
}

export async function asyncFind<T>(asyncIterable: AsyncIterable<T>, predicate: (t: T) => Promise<boolean>): Promise<T> {
    for await (const value of asyncIterable) {
        if (await predicate(value)) {
            return value;
        }
    }
}
