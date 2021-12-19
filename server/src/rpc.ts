import vm from 'vm';

const finalizerIdSymbol = Symbol('rpcFinalizerId');

function getDefaultTransportSafeArgumentTypes() {
    const jsonSerializable = new Set<string>();
    jsonSerializable.add(Number.name);
    jsonSerializable.add(String.name);
    jsonSerializable.add(Object.name);
    jsonSerializable.add(Boolean.name);
    jsonSerializable.add(Array.name);
    return jsonSerializable;
}

export interface RpcMessage {
    type: string;
}

interface RpcParam extends RpcMessage {
    id: string;
    param: string;
}

interface RpcApply extends RpcMessage {
    id: string;
    proxyId: string;
    args: any[];
    method: string;
    oneway?: boolean;
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
    __remote_proxy_finalizer_id: string;
    __remote_constructor_name: string;
    __remote_proxy_props: any;
    __remote_proxy_oneway_methods: string[];
    __serialized_value?: any;
}

interface RpcLocalProxyValue {
    __local_proxy_id: string;
}

interface RpcFinalize extends RpcMessage {
    __local_proxy_id: string;
    __local_proxy_finalizer_id: string;
}

interface Deferred {
    resolve: any;
    reject: any;
}

export function handleFunctionInvocations(thiz: ProxyHandler<any>, target: any, p: PropertyKey, receiver: any): any {
    if (p === 'apply') {
        return (thisArg: any, args: any[]) => {
            return thiz.apply(target, thiz, args);
        }
    }
    else if (p === 'call') {
        return (thisArg: any, ...args: any[]) => {
            return thiz.apply(target, thiz, args);
        }
    }
}

export const PROPERTY_PROXY_ONEWAY_METHODS = '__proxy_oneway_methods';
export const PROPERTY_JSON_DISABLE_SERIALIZATION = '__json_disable_serialization';
export const PROPERTY_PROXY_PROPERTIES = '__proxy_props';
export const PROPERTY_JSON_COPY_SERIALIZE_CHILDREN = '__json_copy_serialize_children';

class RpcProxy implements ProxyHandler<any> {

    constructor(public peer: RpcPeer,
        public entry: LocalProxiedEntry,
        public constructorName: string,
        public proxyProps: any,
        public proxyOneWayMethods: string[]) {
    }

    get(target: any, p: PropertyKey, receiver: any): any {
        if (p === '__proxy_id')
            return this.entry.id;
        if (p === '__proxy_constructor')
            return this.constructorName;
        if (p === '__proxy_peer')
            return this.peer;
        if (p === PROPERTY_PROXY_PROPERTIES)
            return this.proxyProps;
        if (p === PROPERTY_PROXY_ONEWAY_METHODS)
            return this.proxyOneWayMethods;
        if (p === PROPERTY_JSON_DISABLE_SERIALIZATION || p === PROPERTY_JSON_COPY_SERIALIZE_CHILDREN)
            return;
        if (p === 'then')
            return;
        if (p === 'constructor')
            return;
        if (this.proxyProps?.[p] !== undefined)
            return this.proxyProps?.[p];
        const handled = handleFunctionInvocations(this, target, p, receiver);
        if (handled)
            return handled;
        return new Proxy(() => p, this);
    }

    set(target: any, p: string | symbol, value: any, receiver: any): boolean {
        if (p === finalizerIdSymbol)
            this.entry.finalizerId = value;
        return true;
    }

    apply(target: any, thisArg: any, argArray?: any): any {
        // rpc objects can be functions. if the function is a oneway method,
        // it will have a null in the oneway method list. this is because
        // undefined is not JSON serializable.
        const method = target() || null;
        const args: any[] = [];
        for (const arg of (argArray || [])) {
            args.push(this.peer.serialize(arg));
        }

        const rpcApply: RpcApply = {
            type: "apply",
            id: undefined,
            proxyId: this.entry.id,
            args,
            method,
        };

        if (this.proxyOneWayMethods?.includes?.(method)) {
            rpcApply.oneway = true;
            this.peer.send(rpcApply);
            return Promise.resolve();
        }

        return this.peer.createPendingResult((id, reject) => {
            rpcApply.id = id;
            this.peer.send(rpcApply, reject);
        })
    }
}

// todo: error constructor adds a "cause" variable in Chrome 93, Node v??
export class RPCResultError extends Error {
    constructor(peer: RpcPeer, message: string, public cause?: Error, options?: { name: string, stack: string}) {
        super(`${peer.selfName}:${peer.peerName}: ${message}`);

        if (options?.name) {
            this.name = options?.name;
        }
        if (options?.stack) {
            this.stack = `${peer.peerName}:${peer.selfName}\n${cause?.stack || options.stack}`;
        }
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

interface LocalProxiedEntry {
    id: string;
    finalizerId: string;
}

export class RpcPeer {
    idCounter = 1;
    onOob: (oob: any) => void;
    params: { [name: string]: any } = {};
    pendingResults: { [id: string]: Deferred } = {};
    proxyCounter = 1;
    localProxied = new Map<any, LocalProxiedEntry>();
    localProxyMap: { [id: string]: any } = {};
    remoteWeakProxies: { [id: string]: WeakRef<any> } = {};
    finalizers = new FinalizationRegistry(entry => this.finalize(entry as LocalProxiedEntry));
    nameDeserializerMap = new Map<string, RpcSerializer>();
    constructorSerializerMap = new Map<string, string>();
    transportSafeArgumentTypes = getDefaultTransportSafeArgumentTypes();

    constructor(public selfName: string, public peerName: string, public send: (message: RpcMessage, reject?: (e: Error) => void) => void) {
    }

    createPendingResult(cb: (id: string, reject: (e: Error) => void) => void): Promise<any> {
        if (Object.isFrozen(this.pendingResults))
            return Promise.reject(new RPCResultError(this, 'RpcPeer has been killed'));

        const promise = new Promise((resolve, reject) => {
            const id = (this.idCounter++).toString();
            this.pendingResults[id] = { resolve, reject };

            cb(id, e => reject(new RPCResultError(this, e.message, e)));
        });

        // todo: make this an option so rpc doesn't nuke the process if uncaught?
        promise.catch(() => { });

        return promise;
    }

    kill(message?: string) {
        const error = new RPCResultError(this, message || 'peer was killed');
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

    finalize(entry: LocalProxiedEntry) {
        delete this.remoteWeakProxies[entry.id];
        const rpcFinalize: RpcFinalize = {
            __local_proxy_id: entry.id,
            __local_proxy_finalizer_id: entry.finalizerId,
            type: 'finalize',
        }
        this.send(rpcFinalize);
    }

    async getParam(param: string) {
        return this.createPendingResult((id, reject) => {
            const paramMessage: RpcParam = {
                id,
                type: 'param',
                param,
            };

            this.send(paramMessage, reject);
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

        const copySerializeChildren = value[PROPERTY_JSON_COPY_SERIALIZE_CHILDREN];
        if (copySerializeChildren) {
            const ret: any = {};
            for (const [key, val] of Object.entries(value)) {
                ret[key] = this.deserialize(val);
            }
            return ret;
        }

        const { __remote_proxy_id, __remote_proxy_finalizer_id, __local_proxy_id, __remote_constructor_name, __serialized_value, __remote_proxy_props, __remote_proxy_oneway_methods } = value;
        if (__remote_proxy_id) {
            let proxy = this.remoteWeakProxies[__remote_proxy_id]?.deref();
            if (!proxy)
                proxy = this.newProxy(__remote_proxy_id, __remote_constructor_name, __remote_proxy_props, __remote_proxy_oneway_methods);
            proxy[finalizerIdSymbol] = __remote_proxy_finalizer_id;
            return proxy;
        }

        if (__local_proxy_id) {
            const ret = this.localProxyMap[__local_proxy_id];
            if (!ret)
                throw new RPCResultError(this, `invalid local proxy id ${__local_proxy_id}`);
            return ret;
        }

        if (this.nameDeserializerMap.has(__remote_constructor_name)) {
            return this.nameDeserializerMap.get(__remote_constructor_name).deserialize(__serialized_value);
        }

        return value;
    }

    serialize(value: any): any {
        if (value?.[PROPERTY_JSON_COPY_SERIALIZE_CHILDREN] === true) {
            const ret: any = {};
            for (const [key, val] of Object.entries(value)) {
                ret[key] = this.serialize(val);
            }
            return ret;
        }

        if (!value || (!value[PROPERTY_JSON_DISABLE_SERIALIZATION] && this.transportSafeArgumentTypes.has(value.constructor?.name))) {
            return value;
        }

        let __remote_constructor_name = value.__proxy_constructor || value.constructor?.name?.toString();

        let proxiedEntry = this.localProxied.get(value);
        if (proxiedEntry) {
            const __remote_proxy_finalizer_id = (this.proxyCounter++).toString();
            proxiedEntry.finalizerId = __remote_proxy_finalizer_id;
            const ret: RpcRemoteProxyValue = {
                __remote_proxy_id: proxiedEntry.id,
                __remote_proxy_finalizer_id,
                __remote_constructor_name,
                __remote_proxy_props: value?.[PROPERTY_PROXY_PROPERTIES],
                __remote_proxy_oneway_methods: value?.[PROPERTY_PROXY_ONEWAY_METHODS],
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
            const ret: RpcRemoteProxyValue = {
                __remote_proxy_id: undefined,
                __remote_proxy_finalizer_id: undefined,
                __remote_constructor_name,
                __remote_proxy_props: value?.[PROPERTY_PROXY_PROPERTIES],
                __remote_proxy_oneway_methods: value?.[PROPERTY_PROXY_ONEWAY_METHODS],
                __serialized_value: serialized,
            }
            return ret;
        }

        const __remote_proxy_id = (this.proxyCounter++).toString();
        proxiedEntry = {
            id: __remote_proxy_id,
            finalizerId: __remote_proxy_id,
        };
        this.localProxied.set(value, proxiedEntry);
        this.localProxyMap[__remote_proxy_id] = value;

        const ret: RpcRemoteProxyValue = {
            __remote_proxy_id,
            __remote_proxy_finalizer_id: __remote_proxy_id,
            __remote_constructor_name,
            __remote_proxy_props: value?.[PROPERTY_PROXY_PROPERTIES],
            __remote_proxy_oneway_methods: value?.[PROPERTY_PROXY_ONEWAY_METHODS],
        }

        return ret;
    }

    newProxy(proxyId: string, proxyConstructorName: string, proxyProps: any, proxyOneWayMethods: string[]) {
        const localProxiedEntry: LocalProxiedEntry = {
            id: proxyId,
            finalizerId: undefined,
        }
        const rpc = new RpcProxy(this, localProxiedEntry, proxyConstructorName, proxyProps, proxyOneWayMethods);
        const target = proxyConstructorName === 'Function' || proxyConstructorName === 'AsyncFunction' ? function () { } : rpc;
        const proxy = new Proxy(target, rpc);
        const weakref = new WeakRef(proxy);
        this.remoteWeakProxies[proxyId] = weakref;
        this.finalizers.register(rpc, localProxiedEntry);
        global.gc?.();
        return proxy;
    }

    async handleMessage(message: RpcMessage) {
        try {
            switch (message.type) {
                case 'param': {
                    const rpcParam = message as RpcParam;
                    const result: RpcResult = {
                        type: 'result',
                        id: rpcParam.id,
                        result: this.serialize(this.params[rpcParam.param])
                    };
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
                        for (const arg of (rpcApply.args || [])) {
                            args.push(this.deserialize(arg));
                        }

                        let value: any;
                        if (rpcApply.method) {
                            const method = target[rpcApply.method];
                            if (!method)
                                throw new Error(`target ${target?.constructor?.name} does not have method ${rpcApply.method}`);
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

                    if (!rpcApply.oneway)
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
                        const e = new RPCResultError(this, rpcResult.message, undefined, {
                            name: rpcResult.result,
                            stack: rpcResult.stack,
                        });
                        deferred.reject(e);
                        return;
                    }
                    deferred.resolve(this.deserialize(rpcResult.result));
                    break;
                }
                case 'finalize': {
                    const rpcFinalize = message as RpcFinalize;
                    const local = this.localProxyMap[rpcFinalize.__local_proxy_id];
                    if (local) {
                        const localProxiedEntry = this.localProxied.get(local);
                        // if a finalizer id is specified, it must match.
                        if (rpcFinalize.__local_proxy_finalizer_id && rpcFinalize.__local_proxy_finalizer_id !== localProxiedEntry?.finalizerId) {
                            console.error(this.selfName, this.peerName, 'finalizer mismatch')
                            break;
                        }
                        delete this.localProxyMap[rpcFinalize.__local_proxy_id];
                        this.localProxied.delete(local);
                    }
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
            console.error('unhandled rpc error', this.peerName, e);
            return;
        }
    }
}