// request is used by the eval, do not remove.
export function evalRequest(value: string, request: any) {
    if (value.startsWith('`'))
        value = eval(value) as string;
    return value.split(' ');
}
