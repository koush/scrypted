import type { RpcPeer } from "./rpc";

export interface CompileFunctionOptions {
    filename?: string;
}

function compileFunction(): any {
    // this is a hacky way of preventing the closure from capturing the code variable which may be a large blob.
    try {
        // "new Function" can't be used directly because it injects newlines per parameter,
        // which causes source mapping to get misaligned.
        // However, using eval inside a function works, because there are no parameters,
        // and the "new Function" addresses the closure capture issue.
        const f = new Function('return eval(globalThis.compileFunctionShim)');
        return f();
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
