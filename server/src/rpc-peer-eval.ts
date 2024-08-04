import type { RpcPeer } from "./rpc";

export interface CompileFunctionOptions {
    filename?: string;
}

function compileFunction(): any {
    // this is a hacky way of preventing the closure from capturing the code variable which may be a large blob.
    try {
        // "new Function" can't be used because it injects newlines per parameter.
        // this causes source mapping to get misaligned.
        return eval((globalThis as any).compileFunctionShim);
    }
    finally {
        delete (globalThis as any).compileFunctionShim;
    }
}

export function evalLocal<T>(peer: RpcPeer, script: string, filename?: string, coercedParams?: { [name: string]: any }): T {
    const params = Object.assign({}, peer.params, coercedParams);
    let code = script;
    if (filename)
        code = `${code}\n//# sourceURL=${filename}\n`;
    (globalThis as any).compileFunctionShim = `(function(${Object.keys(params).join(',')}) {;${code}\n;})`;
    const f = compileFunction();
    const value = f(...Object.values(params));
    return value;
}
