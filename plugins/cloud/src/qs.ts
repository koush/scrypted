export function qsstringify(dict: any) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(dict)) {
        if (v == null)
            continue;
        params.set(k, v?.toString());
    }

    return params.toString();
}

export function qsparse(search: URLSearchParams) {
    const ret: any = {};
    for (const [k, v] of search.entries()) {
        ret[k] = v;
    }
    return ret;
}