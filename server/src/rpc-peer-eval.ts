import type { RpcPeer } from "./rpc";

export interface CompileFunctionOptions {
    filename?: string;
}

function compileFunction(code: string, params?: ReadonlyArray<string>, options?: CompileFunctionOptions): any {
    params = params || [];
    if (options?.filename)
        code = `${code}\n//# sourceURL=${options.filename}\n`;
    return new Function(...params, code);
}

export function evalLocal<T>(peer: RpcPeer, script: string, filename?: string, coercedParams?: { [name: string]: any }): T {
    const params = Object.assign({}, peer.params, coercedParams);
    const f = compileFunction(script, Object.keys(params), {
        filename,
    });
    const value = f(...Object.values(params));
    return value;
}
