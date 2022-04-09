export function cloneDeep(o: any) {
    if (!o)
        return;
    return JSON.parse(JSON.stringify(o));
}
