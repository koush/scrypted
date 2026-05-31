export function createCachingMapPromiseDebouncer<T>(duration: number) {
    const map = new Map<string, Promise<T>>();

    return (key: any, func: () => Promise<T>): Promise<T> => {
        const keyStr = JSON.stringify(key);
        let value = map.get(keyStr);
        if (!value) {
            value = func();
            map.set(keyStr, value);
            setTimeout(() => map.delete(keyStr), duration);
        }
        return value;
    }
}
