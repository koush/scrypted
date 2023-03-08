import type { CompileFunctionOptions } from 'vm';
type CompileFunction = (code: string, params?: ReadonlyArray<string>, options?: CompileFunctionOptions) => Function;

export function startPeriodicGarbageCollection() {
    if (!global.gc) {
        console.warn('rpc peer garbage collection not available: global.gc is not exposed.');
    }
    let g: typeof global;
    try {
        g = global;
    }
    catch (e) {
    }

    // periodically see if new objects were created or finalized,
    // and collect gc if so.
    let lastCollection = 0;
    return setInterval(() => {
        const now = Date.now();
        const sinceLastCollection = now - lastCollection;
        const remotesCreated = RpcPeer.remotesCreated;
        RpcPeer.remotesCreated = 0;
        const remotesCollected = RpcPeer.remotesCollected;
        RpcPeer.remotesCollected = 0;
        if (remotesCreated || remotesCollected || sinceLastCollection > 5 * 60 * 1000) {
            lastCollection = now;
            g?.gc?.();
        }
    }, 10000);
}

export interface RpcMessage {
    type: string;
}

interface RpcParam extends RpcMessage {
    id: string;
    param: string;
}

interface RpcApply extends RpcMessage {
    id: string | undefined;
    proxyId: string;
    args: any[];
    method: string;
    oneway?: boolean;
}

interface RpcResult extends RpcMessage {
    id: string;
    // TODO 3/2/2023
    // deprecate these properties from rpc protocol. treat error results like any other result
    // and auto serialize them.
    /**
     * @deprecated
     */
    stack?: string;
    /**
     * @deprecated
     */
    message?: string;
    throw?: boolean;
    result?: any;
}

interface RpcRemoteProxyValue {
    __remote_proxy_id: string | undefined;
    __remote_proxy_finalizer_id: string | undefined;
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
    __local_proxy_finalizer_id: string | undefined;
}

interface Deferred {
    resolve: any;
    reject: any;
}

export interface PrimitiveProxyHandler<T extends object> extends ProxyHandler<T> {
    toPrimitive(): any;
}

class RpcProxy implements PrimitiveProxyHandler<any> {
    static iteratorMethods = new Set([
        'next',
        'throw',
        'return',
    ]);

    constructor(public peer: RpcPeer,
        public entry: LocalProxiedEntry,
        public constructorName: string,
        public proxyProps: any,
        public proxyOneWayMethods: string[]) {
    }

    toPrimitive() {
        const peer = this.peer;
        return `RpcProxy-${peer.selfName}:${peer.peerName}: ${this.constructorName}`;
    }

    get(target: any, p: PropertyKey, receiver: any): any {
        if (p === Symbol.asyncIterator) {
            if (!this.proxyProps?.[Symbol.asyncIterator.toString()])
                return;
            return () => {
                return new Proxy(() => { }, this);
            };
        }
        if (RpcProxy.iteratorMethods.has(p?.toString())) {
            const asyncIteratorMethod = this.proxyProps?.[Symbol.asyncIterator.toString()]?.[p];
            if (asyncIteratorMethod)
                return new Proxy(() => asyncIteratorMethod, this);
        }
        if (p === RpcPeer.PROPERTY_PROXY_ID)
            return this.entry.id;
        if (p === '__proxy_constructor')
            return this.constructorName;
        if (p === '__proxy_peer')
            return this.peer;
        if (p === RpcPeer.PROPERTY_PROXY_PROPERTIES)
            return this.proxyProps;
        if (p === RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS)
            return this.proxyOneWayMethods;
        if (p === RpcPeer.PROPERTY_JSON_DISABLE_SERIALIZATION || p === RpcPeer.PROPERTY_JSON_COPY_SERIALIZE_CHILDREN)
            return;
        if (p === 'then')
            return;
        if (p === 'constructor')
            return;
        if (this.proxyProps?.[p] !== undefined)
            return this.proxyProps?.[p];
        const handled = RpcPeer.handleFunctionInvocations(this, target, p, receiver);
        if (handled)
            return handled;
        return new Proxy(() => p, this);
    }

    set(target: any, p: string | symbol, value: any, receiver: any): boolean {
        if (p === RpcPeer.finalizerIdSymbol) {
            this.entry.finalizerId = value;
        }
        else {
            this.proxyProps ||= {};
            this.proxyProps[p] = value;
        }

        return true;
    }

    apply(target: any, thisArg: any, argArray?: any): any {
        const method = target() || null;
        const oneway = this.proxyOneWayMethods?.includes?.(method);

        if (Object.isFrozen(this.peer.pendingResults)) {
            if (oneway)
                return Promise.resolve();
            return Promise.reject(new RPCResultError(this.peer, 'RpcPeer has been killed (apply) ' + target()));
        }

        // rpc objects can be functions. if the function is a oneway method,
        // it will have a null in the oneway method list. this is because
        // undefined is not JSON serializable.
        const args: any[] = [];
        const serializationContext: any = {};
        for (const arg of (argArray || [])) {
            args.push(this.peer.serialize(arg, serializationContext));
        }

        const rpcApply: RpcApply = {
            type: "apply",
            id: undefined,
            proxyId: this.entry.id,
            args,
            method,
        };

        if (oneway) {
            rpcApply.oneway = true;
            // a oneway callable object doesn't need to be in the JSON payload.
            if (method === null)
                delete rpcApply.method;
            this.peer.send(rpcApply, undefined, serializationContext);
            return Promise.resolve();
        }

        const pendingResult = this.peer.createPendingResult((id, reject) => {
            rpcApply.id = id;
            this.peer.send(rpcApply, reject, serializationContext);
        });

        const asyncIterator = this.proxyProps?.[Symbol.asyncIterator.toString()];
        if (!asyncIterator || method !== asyncIterator.next)
            return pendingResult;

        return pendingResult
            .then(value => {
                return ({
                    value,
                    done: false,
                });
            })
            .catch(e => {
                if (e.name === 'StopAsyncIteration') {
                    return {
                        done: true,
                        value: undefined,
                    }
                }
                throw e;
            })
    }
}

interface SerialiedRpcResultError {
    name: string;
    stack: string;
    message: string;
}

// todo: error constructor adds a "cause" variable in Chrome 93, Node v??
export class RPCResultError extends Error {
    constructor(peer: RpcPeer, message: string, public cause?: Error, options?: { name: string, stack: string | undefined }) {
        super(`${message}\n${peer.selfName}:${peer.peerName}`);

        if (options?.name) {
            this.name = options?.name;
        }
        if (options?.stack) {
            this.stack = `${cause?.stack || options.stack}\n${peer.peerName}:${peer.selfName}`;
        }
    }
}

function compileFunction(code: string, params?: ReadonlyArray<string>, options?: CompileFunctionOptions): any {
    params = params || [];
    const f = `(function(${params.join(',')}) {;${code};})`;
    return eval(f);
}

declare class WeakRef<T> {
    target: T;
    constructor(target: any);
    deref(): T;
}

try {
    // @ts-ignore
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
    serialize(value: any, serializationContext?: any): any;
    deserialize(serialized: any, serializationContext?: any): any;
}

interface LocalProxiedEntry {
    id: string;
    finalizerId: string | undefined;
}

interface ErrorType {
    name: string;
    message: string;
    stack?: string;
}

export class RpcPeer {
    idCounter = 1;
    params: { [name: string]: any } = {};
    pendingResults: { [id: string]: Deferred } = {};
    proxyCounter = 1;
    localProxied = new Map<any, LocalProxiedEntry>();
    localProxyMap: { [id: string]: any } = {};
    // @ts-ignore
    remoteWeakProxies: { [id: string]: WeakRef<any> } = {};
    // @ts-ignore
    finalizers = new FinalizationRegistry(entry => this.finalize(entry as LocalProxiedEntry));
    nameDeserializerMap = new Map<string, RpcSerializer>();
    onProxyTypeSerialization = new Map<string, (value: any) => void>();
    onProxySerialization: (value: any, proxyId: string) => void;
    constructorSerializerMap = new Map<any, string>();
    transportSafeArgumentTypes = RpcPeer.getDefaultTransportSafeArgumentTypes();
    killed: Promise<string>;
    killedDeferred: Deferred;
    tags: any = {};

    static readonly finalizerIdSymbol = Symbol('rpcFinalizerId');
    static remotesCollected = 0;
    static remotesCreated = 0;
    static activeRpcPeer: RpcPeer;

    static isRpcProxy(value: any) {
        return !!value?.[RpcPeer.PROPERTY_PROXY_ID];
    }

    static getDefaultTransportSafeArgumentTypes() {
        const jsonSerializable = new Set<string>();
        jsonSerializable.add(Number.name);
        jsonSerializable.add(String.name);
        jsonSerializable.add(Object.name);
        jsonSerializable.add(Boolean.name);
        jsonSerializable.add(Array.name);
        return jsonSerializable;
    }

    static handleFunctionInvocations(thiz: PrimitiveProxyHandler<any>, target: any, p: PropertyKey, receiver: any): any {
        if (p === 'apply') {
            return (thisArg: any, args: any[]) => {
                return thiz.apply!(target, thiz, args);
            }
        }
        else if (p === 'call') {
            return (thisArg: any, ...args: any[]) => {
                return thiz.apply!(target, thiz, args);
            }
        }
        else if (p === 'toString' || p === Symbol.toPrimitive) {
            return (thisArg: any, ...args: any[]) => {
                return thiz.toPrimitive();
            }
        }
    }

    static setProxyProperties(value: any, properties: any) {
        value[RpcPeer.PROPERTY_PROXY_PROPERTIES] = properties;
    }

    static getProxyProperties(value: any) {
        return value?.[RpcPeer.PROPERTY_PROXY_PROPERTIES];
    }

    static prepareProxyProperties(value: any) {
        let props = value?.[RpcPeer.PROPERTY_PROXY_PROPERTIES];
        if (!value[Symbol.asyncIterator])
            return props;
        props ||= {};
        props[Symbol.asyncIterator.toString()] = {
            next: 'next',
            throw: 'throw',
            return: 'return',
        };
        return props;
    }

    static readonly RPC_RESULT_ERROR_NAME = 'RPCResultError';
    static readonly PROPERTY_PROXY_ID = '__proxy_id';
    static readonly PROPERTY_PROXY_ONEWAY_METHODS = '__proxy_oneway_methods';
    static readonly PROPERTY_JSON_DISABLE_SERIALIZATION = '__json_disable_serialization';
    static readonly PROPERTY_PROXY_PROPERTIES = '__proxy_props';
    static readonly PROPERTY_JSON_COPY_SERIALIZE_CHILDREN = '__json_copy_serialize_children';
    static readonly PROBED_PROPERTIES = new Set<any>([
        'then',
        'constructor',
        '__proxy_id',
        '__proxy_constructor',
        '__proxy_peer',
        RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS,
        RpcPeer.PROPERTY_JSON_DISABLE_SERIALIZATION,
        RpcPeer.PROPERTY_PROXY_PROPERTIES,
        RpcPeer.PROPERTY_JSON_COPY_SERIALIZE_CHILDREN,
    ]);

    constructor(public selfName: string, public peerName: string, public send: (message: RpcMessage, reject?: (e: Error) => void, serializationContext?: any) => void) {
        this.killed = new Promise<string>((resolve, reject) => {
            this.killedDeferred = { resolve, reject };
        }).catch(e => e.message || 'Unknown Error');
    }

    static isTransportSafe(value: any) {
        return !value || (!value[RpcPeer.PROPERTY_JSON_DISABLE_SERIALIZATION] && this.getDefaultTransportSafeArgumentTypes().has(value.constructor?.name));
    }

    isTransportSafe(value: any) {
        return !value || (!value[RpcPeer.PROPERTY_JSON_DISABLE_SERIALIZATION] && this.transportSafeArgumentTypes.has(value.constructor?.name));
    }

    createPendingResult(cb: (id: string, reject: (e: Error) => void) => void): Promise<any> {
        if (Object.isFrozen(this.pendingResults))
            return Promise.reject(new RPCResultError(this, 'RpcPeer has been killed (createPendingResult)'));

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
        if (Object.isFrozen(this.pendingResults))
            return;
        const error = new RPCResultError(this, message || 'peer was killed');
        this.killedDeferred.reject(error);
        for (const result of Object.values(this.pendingResults)) {
            result.reject(error);
        }
        this.pendingResults = Object.freeze({});
        this.params = Object.freeze({});
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
        RpcPeer.remotesCollected++;

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

    evalLocal<T>(script: string, filename?: string, coercedParams?: { [name: string]: any }): T {
        const params = Object.assign({}, this.params, coercedParams);
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

    /**
     * @deprecated
     * @param result
     * @param e
     */
    createErrorResult(result: RpcResult, e: ErrorType) {
        result.result = this.serializeError(e);
        result.throw = true;
        result.message = (e as Error).message || 'no message';
        result.stack = e.stack || 'no stack';
    }

    deserialize(value: any, deserializationContext: any): any {
        if (!value)
            return value;

        const copySerializeChildren = value[RpcPeer.PROPERTY_JSON_COPY_SERIALIZE_CHILDREN];
        if (copySerializeChildren) {
            const ret: any = {};
            for (const [key, val] of Object.entries(value)) {
                ret[key] = this.deserialize(val, deserializationContext);
            }
            return ret;
        }

        const { __remote_proxy_id, __remote_proxy_finalizer_id, __local_proxy_id, __remote_constructor_name, __serialized_value, __remote_proxy_props, __remote_proxy_oneway_methods } = value;
        if (__remote_constructor_name === RpcPeer.RPC_RESULT_ERROR_NAME)
            return this.deserializeError(__serialized_value);

        if (__remote_proxy_id) {
            let proxy = this.remoteWeakProxies[__remote_proxy_id]?.deref();
            if (!proxy)
                proxy = this.newProxy(__remote_proxy_id, __remote_constructor_name, __remote_proxy_props, __remote_proxy_oneway_methods);
            proxy[RpcPeer.finalizerIdSymbol] = __remote_proxy_finalizer_id;

            const deserializer = this.nameDeserializerMap.get(__remote_constructor_name);
            if (deserializer) {
                return deserializer.deserialize(proxy, deserializationContext);
            }

            return proxy;
        }

        if (__local_proxy_id) {
            const ret = this.localProxyMap[__local_proxy_id];
            if (!ret)
                throw new RPCResultError(this, `invalid local proxy id ${__local_proxy_id}`);
            return ret;
        }

        const deserializer = this.nameDeserializerMap.get(__remote_constructor_name);
        if (deserializer) {
            return deserializer.deserialize(__serialized_value, deserializationContext);
        }

        return value;
    }

    deserializeError(e: SerialiedRpcResultError): RPCResultError {
        const { name, stack, message } = e;
        return new RPCResultError(this, message, undefined, { name, stack });
    }

    serializeError(e: ErrorType): RpcRemoteProxyValue {
        const __serialized_value: SerialiedRpcResultError = {
            stack: e.stack || '[no stack]',
            name: e.name || '[no name]',
            message: e.message || '[no message]',
        }
        return {
            // probably not safe to use constructor.name
            __remote_constructor_name: RpcPeer.RPC_RESULT_ERROR_NAME,
            __remote_proxy_id: undefined,
            __remote_proxy_finalizer_id: undefined,
            __remote_proxy_oneway_methods: undefined,
            __remote_proxy_props: undefined,
            __serialized_value,
        };
    }

    serialize(value: any, serializationContext: any): any {
        if (value?.[RpcPeer.PROPERTY_JSON_COPY_SERIALIZE_CHILDREN] === true) {
            const ret: any = {};
            for (const [key, val] of Object.entries(value)) {
                ret[key] = this.serialize(val, serializationContext);
            }
            return ret;
        }

        if (this.isTransportSafe(value)) {
            return value;
        }

        let __remote_constructor_name = value.__proxy_constructor || value.constructor?.name?.toString();

        if (value instanceof Error)
            return this.serializeError(value);

        let proxiedEntry = this.localProxied.get(value);
        if (proxiedEntry) {
            const __remote_proxy_finalizer_id = (this.proxyCounter++).toString();
            proxiedEntry.finalizerId = __remote_proxy_finalizer_id;
            const ret: RpcRemoteProxyValue = {
                __remote_proxy_id: proxiedEntry.id,
                __remote_proxy_finalizer_id,
                __remote_constructor_name,
                __remote_proxy_props: RpcPeer.prepareProxyProperties(value),
                __remote_proxy_oneway_methods: value?.[RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS],
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

        this.onProxyTypeSerialization.get(__remote_constructor_name)?.(value);

        const serializerMapName = this.constructorSerializerMap.get(value.constructor);
        if (serializerMapName) {
            __remote_constructor_name = serializerMapName;
            const serializer = this.nameDeserializerMap.get(serializerMapName);
            if (!serializer)
                throw new Error('serializer not found for ' + serializerMapName);
            const serialized = serializer.serialize(value, serializationContext);
            const ret: RpcRemoteProxyValue = {
                __remote_proxy_id: undefined,
                __remote_proxy_finalizer_id: undefined,
                __remote_constructor_name,
                __remote_proxy_props: RpcPeer.prepareProxyProperties(value),
                __remote_proxy_oneway_methods: value?.[RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS],
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

        this.onProxySerialization?.(value, __remote_proxy_id);

        const ret: RpcRemoteProxyValue = {
            __remote_proxy_id,
            __remote_proxy_finalizer_id: __remote_proxy_id,
            __remote_constructor_name,
            __remote_proxy_props: RpcPeer.prepareProxyProperties(value),
            __remote_proxy_oneway_methods: value?.[RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS],
        }

        return ret;
    }

    newProxy(proxyId: string, proxyConstructorName: string, proxyProps: any, proxyOneWayMethods: string[]) {
        RpcPeer.remotesCreated++;

        const localProxiedEntry: LocalProxiedEntry = {
            id: proxyId,
            finalizerId: undefined,
        }
        const rpc = new RpcProxy(this, localProxiedEntry, proxyConstructorName, proxyProps, proxyOneWayMethods);
        const target = proxyConstructorName === 'Function' || proxyConstructorName === 'AsyncFunction' ? function () { } : rpc;
        const proxy = new Proxy(target, rpc);
        // @ts-ignore
        const weakref = new WeakRef(proxy);
        this.remoteWeakProxies[proxyId] = weakref;
        this.finalizers.register(rpc, localProxiedEntry);
        return proxy;
    }

    handleMessage(message: RpcMessage, deserializationContext?: any) {
        try {
            RpcPeer.activeRpcPeer = this;
            this.handleMessageInternal(message, deserializationContext);
        }
        finally {
            RpcPeer.activeRpcPeer = undefined;
        }
    }

    private async handleMessageInternal(message: RpcMessage, deserializationContext?: any) {
        if (Object.isFrozen(this.pendingResults))
            return;

        try {
            switch (message.type) {
                case 'param': {
                    const rpcParam = message as RpcParam;
                    const serializationContext: any = {};
                    const result: RpcResult = {
                        type: 'result',
                        id: rpcParam.id,
                        result: this.serialize(this.params[rpcParam.param], serializationContext)
                    };
                    this.send(result, undefined, serializationContext);
                    break;
                }
                case 'apply': {
                    const rpcApply = message as RpcApply;
                    const result: RpcResult = {
                        type: 'result',
                        id: rpcApply.id || '',
                    };
                    const serializationContext: any = {};

                    try {
                        const target = this.localProxyMap[rpcApply.proxyId];
                        if (!target)
                            throw new Error(`proxy id ${rpcApply.proxyId} not found`);

                        const args = [];
                        for (const arg of (rpcApply.args || [])) {
                            args.push(this.deserialize(arg, deserializationContext));
                        }

                        let value: any;
                        if (rpcApply.method) {
                            const method = target[rpcApply.method];
                            if (!method)
                                throw new Error(`target ${target?.constructor?.name} does not have method ${rpcApply.method}`);
                            value = await target[rpcApply.method](...args);

                            if (target[Symbol.asyncIterator] && rpcApply.method === 'next') {
                                if (value.done) {
                                    const errorType: ErrorType = {
                                        name: 'StopAsyncIteration',
                                        message: undefined,
                                    };
                                    throw errorType;
                                }
                                else {
                                    value = value.value;
                                }
                            }
                        }
                        else {
                            value = await target(...args);
                        }

                        result.result = this.serialize(value, serializationContext);
                    }
                    catch (e) {
                        // console.error('failure', rpcApply.method, e);
                        this.createErrorResult(result, e);
                    }

                    if (!rpcApply.oneway)
                        this.send(result, undefined, serializationContext);
                    break;
                }
                case 'result': {
                    // console.log(message)
                    const rpcResult = message as RpcResult;
                    const deferred = this.pendingResults[rpcResult.id];
                    delete this.pendingResults[rpcResult.id];
                    if (!deferred)
                        throw new Error(`unknown result ${rpcResult.id}`);
                    if ((rpcResult.message || rpcResult.stack) && !rpcResult.throw) {
                        const e = new RPCResultError(this, rpcResult.message || 'no message', undefined, {
                            name: rpcResult.result,
                            stack: rpcResult.stack,
                        });
                        deferred.reject(e);
                        return;
                    }
                    const deserialized = this.deserialize(rpcResult.result, deserializationContext);
                    if (rpcResult.throw)
                        deferred.reject(deserialized);
                    else
                        deferred.resolve(deserialized);
                    break;
                }
                case 'finalize': {
                    const rpcFinalize = message as RpcFinalize;
                    const local = this.localProxyMap[rpcFinalize.__local_proxy_id];
                    if (local) {
                        const localProxiedEntry = this.localProxied.get(local);
                        // if a finalizer id is specified, it must match.
                        if (rpcFinalize.__local_proxy_finalizer_id && rpcFinalize.__local_proxy_finalizer_id !== localProxiedEntry?.finalizerId) {
                            break;
                        }
                        delete this.localProxyMap[rpcFinalize.__local_proxy_id];
                        this.localProxied.delete(local);
                    }
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

export function getEvalSource() {
    return `
    (() => {
        ${RpcProxy}

        ${RpcPeer}

        ${startPeriodicGarbageCollection}
    
        return {
            startPeriodicGarbageCollection,
            RpcPeer,
            RpcProxy,
        };
    })();
    `;
}
