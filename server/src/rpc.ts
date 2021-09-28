import vm from 'vm';

const jsonSerializable = new Set<string>();
jsonSerializable.add(Number.name);
jsonSerializable.add(String.name);
jsonSerializable.add(Object.name);
jsonSerializable.add(Boolean.name);
jsonSerializable.add(Array.name);


export interface RpcMessage {
    type: string;
}

interface RpcEval extends RpcMessage {
    id: string;
    script: string;
    filename: string;
    params: { [name: string]: any };
    requireProxy: boolean;
}

interface RpcApply extends RpcMessage {
    id: string;
    proxyId: string;
    argArray: any;
    method: string;
}

interface RpcResult extends RpcMessage {
    id: string;
    stack?: string;
    message?: string;
    result?: any;
}

interface RpcOob extends RpcMessage {
    oob: any;
}

interface RpcRemoteProxyValue {
    __remote_proxy_id: string;
    __remote_constructor_name: string;
    __remote_proxy_props: any;
    __serialized_value?: any;
}

interface RpcLocalProxyValue {
    __local_proxy_id: string;
}

interface RpcFinalize extends RpcMessage {
    __local_proxy_id: string;
}

interface Deferred {
    resolve: any;
    reject: any;
}

export function handleFunctionInvocations(thiz: ProxyHandler<any>, target: any, p: PropertyKey, receiver: any): any {
    if (p === 'apply') {
        return (thisArg: any, args: any[]) => {
            return thiz.apply(target, this, args);
        }
    }
    else if (p === 'call') {
        return (thisArg: any, ...args: any[]) => {
            return thiz.apply(target, this, args);
        }
    }
}

class RpcProxy implements ProxyHandler<any> {
    peer: RpcPeer;
    id: string;
    constructorName: string;
    props: any;

    constructor(peer: RpcPeer, id: string, constructorName: string, proxyProps: any) {
        this.peer = peer;
        this.id = id;
        this.constructorName = constructorName;
        this.props = proxyProps;
    }

    get(target: any, p: PropertyKey, receiver: any): any {
        if (p === '__proxy_id')
            return this.id;
        if (p === '__proxy_constructor')
            return this.constructorName;
        if (p === '__proxy_peer')
            return this.peer;
        if (p === '__proxy_props')
            return this.props;
        if (p === 'then')
            return;
        if (p === 'constructor')
            return;
        if (this.props?.[p] !== undefined)
            return this.props?.[p];
        const handled = handleFunctionInvocations(this, target, p, receiver);
        if (handled)
            return handled;
        return new Proxy(() => p, this);
    }

    apply(target: any, thisArg: any, argArray?: any): any {
        const method = target();
        const args: any[] = [];
        for (const arg of (argArray || [])) {
            args.push(this.peer.serialize(arg));
        }

        return this.peer.createPendingResult(id => {
            const rpcApply: RpcApply = {
                type: "apply",
                id,
                proxyId: this.id,
                argArray: args,
                method,
            };

            this.peer.send(rpcApply, e => new RPCResultError(e.message, e));
        })
    }
}

// todo: error constructor adds a "cause" variable in Chrome 93, Node v??
export class RPCResultError extends Error {
    constructor(message: string, public cause?: Error) {
        super(message);
    }
}

function compileFunction(code: string, params?: ReadonlyArray<string>, options?: vm.CompileFunctionOptions): any {
    params = params || [];
    const f = `(function(${params.join(',')}) {;${code};})`;
    return eval(f);
}

try {
    const fr = FinalizationRegistry;
}
catch (e) {
    (window as any).WeakRef = class WeakRef {
        target: any;
        constructor(target: any) {
            this.target = target;
        }
        deref(): any {
            return this.target;
        }
    };

    (window as any).FinalizationRegistry = class FinalizationRegistry {
        register() {
        }
    }
}

export interface RpcSerializer {
    serialize(value: any): any;
    deserialize(serialized: any): any;
}

export class RpcPeer {
    idCounter = 1;
    onOob: (oob: any) => void;
    params: { [name: string]: any } = {};
    pendingResults: { [id: string]: Deferred } = {};
    proxyCounter = 1;
    localProxied = new Map<any, string>();
    localProxyMap: { [id: string]: any } = {};
    remoteWeakProxies: { [id: string]: WeakRef<any> } = {};
    remoteProxyWrapper: { [constructorName: string]: (proxy: any) => any } = {};
    finalizers = new FinalizationRegistry(id => this.finalize(id as string));
    nameDeserializerMap = new Map<string, RpcSerializer>();
    constructorSerializerMap = new Map<string, string>();

    constructor(public send: (message: RpcMessage, reject?: (e: Error) => void) => void) {
    }

    createPendingResult(cb: (id: string) => void): Promise<any> {
        if (Object.isFrozen(this.pendingResults))
            return Promise.reject(Error('RpcPeer has been killed'));

        const promise = new Promise((resolve, reject) => {
            const id = (this.idCounter++).toString();
            this.pendingResults[id] = { resolve, reject };

            cb(id);
        });

        // todo: make this an option so rpc doesn't nuke the process if uncaught?
        promise.catch(() => { });

        return promise;
    }

    kill(message?: string) {
        const error = new RPCResultError(message || 'peer was killed');
        for (const result of Object.values(this.pendingResults)) {
            result.reject(error);
        }
        this.pendingResults = Object.freeze({});
        this.remoteWeakProxies = Object.freeze({});
        this.localProxyMap = Object.freeze({});
        this.localProxied.clear();
    }

    // need a name/constructor map due to babel name mangling? fix somehow?
    addSerializer(ctr: any, name: string, serializer: RpcSerializer) {
        this.nameDeserializerMap.set(name, serializer);
        this.constructorSerializerMap.set(ctr, name);
    }

    finalize(id: string) {
        delete this.remoteWeakProxies[id];
        const rpcFinalize: RpcFinalize = {
            __local_proxy_id: id,
            type: 'finalize',
        }
        this.send(rpcFinalize);
    }

    eval(script: string, filename?: string, params?: { [name: string]: any }, requireProxy?: boolean): Promise<any> {
        return this.createPendingResult(id => {
            const coercedParams: { [name: string]: any } = {};
            for (const key of Object.keys(params || {})) {
                coercedParams[key] = this.serialize(params[key]);
            }

            const evalMessage: RpcEval = {
                type: 'eval',
                id,
                script,
                filename,
                params: coercedParams,
                requireProxy,
            };

            this.send(evalMessage, e => new RPCResultError(e.message, e));
        });
    }

    sendOob(oob: any) {
        this.send({
            type: 'oob',
            oob,
        } as RpcOob)
    }

    evalLocal<T>(script: string, filename?: string, coercedParams?: { [name: string]: any }): T {
        const params = Object.assign({}, this.params, coercedParams);
        const f = (vm.compileFunction || compileFunction)(script, Object.keys(params), {
            filename,
        });
        const value = f(...Object.values(params));
        return value;
    }

    createErrorResult(result: RpcResult, e: any) {
        result.stack = e.stack || 'no stack';
        result.result = (e as Error).name || 'no name';
        result.message = (e as Error).message || 'no message';
    }

    deserialize(value: any): any {
        if (!value)
            return value;
        const { __remote_proxy_id, __local_proxy_id, __remote_constructor_name, __serialized_value, __remote_proxy_props } = value;
        if (__remote_proxy_id) {
            const proxy = this.remoteWeakProxies[__remote_proxy_id]?.deref() || this.newProxy(__remote_proxy_id, __remote_constructor_name, __remote_proxy_props);
            return proxy;
        }

        if (__local_proxy_id) {
            const ret = this.localProxyMap[__local_proxy_id];
            if (!ret)
                throw new Error(`invalid local proxy id ${__local_proxy_id}`);
            return ret;
        }

        if (this.nameDeserializerMap.has(__remote_constructor_name)) {
            return this.nameDeserializerMap.get(__remote_constructor_name).deserialize(__serialized_value);
        }

        return value;
    }

    serialize(value: any, requireProxy?: boolean): any {
        if (!value || (!requireProxy && jsonSerializable.has(value.constructor?.name))) {
            return value;
        }

        let __remote_constructor_name = value.__proxy_constructor || value.constructor?.name?.toString();

        let proxyId = this.localProxied.get(value);
        if (proxyId) {
            const ret: RpcRemoteProxyValue = {
                __remote_proxy_id: proxyId,
                __remote_constructor_name,
                __remote_proxy_props: value?.__proxy_props,
            }
            return ret;
        }

        const { __proxy_id, __proxy_peer } = value;
        if (__proxy_id && __proxy_peer === this) {
            const ret: RpcLocalProxyValue = {
                __local_proxy_id: __proxy_id,
            }
            return ret;
        }

        const serializerMapName = this.constructorSerializerMap.get(value.constructor);
        if (serializerMapName) {
            __remote_constructor_name = serializerMapName;
            const serializer = this.nameDeserializerMap.get(serializerMapName);
            const serialized = serializer.serialize(value);
            if (!serialized || (!requireProxy && jsonSerializable.has(serialized.constructor?.name))) {
                const ret: RpcRemoteProxyValue = {
                    __remote_proxy_id: undefined,
                    __remote_constructor_name,
                    __remote_proxy_props: value?.__proxy_props,
                    __serialized_value: value,
                }
                return ret;
            }
        }

        proxyId = (this.proxyCounter++).toString();
        this.localProxied.set(value, proxyId);
        this.localProxyMap[proxyId] = value;

        const ret: RpcRemoteProxyValue = {
            __remote_proxy_id: proxyId,
            __remote_constructor_name,
            __remote_proxy_props: value?.__proxy_props,
        }

        return ret;
    }

    newProxy(proxyId: string, proxyConstructorName: string, proxyProps: any) {
        const rpc = new RpcProxy(this, proxyId, proxyConstructorName, proxyProps);
        const wrapped = this.remoteProxyWrapper[proxyConstructorName]?.(rpc) || rpc;
        const target = proxyConstructorName === 'Function' ? function () { } : wrapped;
        const proxy = new Proxy(target, wrapped);
        const weakref = new WeakRef(proxy);
        this.remoteWeakProxies[proxyId] = weakref;
        this.finalizers.register(rpc, proxyId);
        global.gc?.();
        return proxy;
    }

    async handleMessage(message: RpcMessage) {
        try {
            switch (message.type) {
                case 'eval': {
                    const rpcEval = message as RpcEval;
                    const result: RpcResult = {
                        type: 'result',
                        id: rpcEval.id,
                    };
                    try {
                        const coercedParams: { [name: string]: any } = {};
                        for (const key of Object.keys(rpcEval.params || {})) {
                            coercedParams[key] = this.deserialize(rpcEval.params[key]);
                        }
                        const params = Object.assign({}, this.params, coercedParams);
                        const value = await this.evalLocal(rpcEval.script, rpcEval.filename, params);

                        result.result = this.serialize(value, rpcEval.requireProxy);
                    }
                    catch (e) {
                        this.createErrorResult(result, e);
                    }

                    this.send(result);
                    break;
                }
                case 'apply': {
                    const rpcApply = message as RpcApply;
                    const result: RpcResult = {
                        type: 'result',
                        id: rpcApply.id,
                    };

                    try {
                        const target = this.localProxyMap[rpcApply.proxyId];
                        if (!target)
                            throw new Error(`proxy id ${rpcApply.proxyId} not found`);

                        const args = [];
                        for (const arg of (rpcApply.argArray || [])) {
                            args.push(this.deserialize(arg));
                        }

                        // const value = rpcApply.method ? await target[rpcApply.method](...args) : await target(...args);
                        let value: any;
                        if (rpcApply.method) {
                            const method = target[rpcApply.method];
                            if (!method)
                                throw new Error(`target ${target?.constructor.name} does not have method ${rpcApply.method}`);
                            value = await target[rpcApply.method](...args);
                        }
                        else {
                            value = await target(...args);
                        }

                        result.result = this.serialize(value);
                    }
                    catch (e) {
                        console.error('failure', rpcApply.method, e);
                        this.createErrorResult(result, e);
                    }

                    this.send(result);
                    break;
                }
                case 'result': {
                    const rpcResult = message as RpcResult;
                    const deferred = this.pendingResults[rpcResult.id];
                    delete this.pendingResults[rpcResult.id];
                    if (!deferred)
                        throw new Error(`unknown result ${rpcResult.id}`);
                    if (rpcResult.message || rpcResult.stack) {
                        const e = new RPCResultError(rpcResult.message)
                        e.name = rpcResult.result;
                        e.stack = rpcResult.stack;
                        deferred.reject(e);
                        return;
                    }
                    deferred.resolve(this.deserialize(rpcResult.result));
                    break;
                }
                case 'finalize': {
                    const rpcFinalize = message as RpcFinalize;
                    const local = this.localProxyMap[rpcFinalize.__local_proxy_id];
                    delete this.localProxyMap[rpcFinalize.__local_proxy_id];
                    this.localProxied.delete(local);
                    break;
                }
                case 'oob': {
                    const rpcOob = message as RpcOob;
                    this.onOob?.(rpcOob.oob);
                    break;
                }
                default:
                    throw new Error(`unknown rpc message type ${message.type}`);
            }
        }
        catch (e) {
            console.error('unhandled rpc error', e);
            return;
        }
    }
}