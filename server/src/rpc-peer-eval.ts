import type { CompileFunctionOptions } from 'vm';
import { RpcPeer } from "./rpc";

type CompileFunction = (code: string, params?: ReadonlyArray<string>, options?: CompileFunctionOptions) => Function;

function compileFunction(code: string, params?: ReadonlyArray<string>, options?: CompileFunctionOptions): any {
    params = params || [];
    const f = `(function(${params.join(',')}) {;${code};})`;
    return eval(f);
}

export function evalLocal<T>(peer: RpcPeer, script: string, filename?: string, coercedParams?: { [name: string]: any }): T {
    const params = Object.assign({}, peer.params, coercedParams);
    let compile: CompileFunction;
    try {
        // prevent bundlers from trying to include non-existent vm module.
        compile = module[`require`]('vm').compileFunction;
    }
    catch (e) {
        compile = compileFunction;
    }
    const f = compile(script, Object.keys(params), {
        filename,
    });
    const value = f(...Object.values(params));
    return value;
}