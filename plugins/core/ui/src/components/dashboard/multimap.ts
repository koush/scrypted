export class Multimap<K, V> extends Map<K, V[]> {
    add(k: K, v: V) {
        let array = this.get(k);
        if (!array) {
            array = [];
            this.set(k, array);
        }

        array.push(v);
    }
}

export class EnsureMap<K, V> extends Map<K, V> {
    ensureFunc: () => V;
    constructor(ensureFunc: () => V) {
        super();
        this.ensureFunc = ensureFunc;
    }
    ensure(k: K) {
        let ret = this.get(k);
        if (!ret) {
            this.set(k, ret = this.ensureFunc());
        }
        return ret;
    }
}
