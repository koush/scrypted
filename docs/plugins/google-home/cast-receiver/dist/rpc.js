export function startPeriodicGarbageCollection() {
    if (!global.gc) {
        console.warn('rpc peer garbage collection not available: global.gc is not exposed.');
        return;
    }
    try {
        const g = global;
        if (g.gc) {
            return setInterval(() => {
                g.gc();
            }, 10000);
        }
    }
    catch (e) {
    }
}
class RpcProxy {
    peer;
    entry;
    constructorName;
    proxyProps;
    proxyOneWayMethods;
    constructor(peer, entry, constructorName, proxyProps, proxyOneWayMethods) {
        this.peer = peer;
        this.entry = entry;
        this.constructorName = constructorName;
        this.proxyProps = proxyProps;
        this.proxyOneWayMethods = proxyOneWayMethods;
    }
    toPrimitive() {
        const peer = this.peer;
        return `RpcProxy-${peer.selfName}:${peer.peerName}: ${this.constructorName}`;
    }
    get(target, p, receiver) {
        if (p === '__proxy_id')
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
    set(target, p, value, receiver) {
        if (p === RpcPeer.finalizerIdSymbol)
            this.entry.finalizerId = value;
        return true;
    }
    apply(target, thisArg, argArray) {
        if (Object.isFrozen(this.peer.pendingResults))
            return Promise.reject(new RPCResultError(this.peer, 'RpcPeer has been killed'));
        // rpc objects can be functions. if the function is a oneway method,
        // it will have a null in the oneway method list. this is because
        // undefined is not JSON serializable.
        const method = target() || null;
        const args = [];
        for (const arg of (argArray || [])) {
            args.push(this.peer.serialize(arg));
        }
        const rpcApply = {
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
        });
    }
}
// todo: error constructor adds a "cause" variable in Chrome 93, Node v??
export class RPCResultError extends Error {
    cause;
    constructor(peer, message, cause, options) {
        super(`${peer.selfName}:${peer.peerName}: ${message}`);
        this.cause = cause;
        if (options?.name) {
            this.name = options?.name;
        }
        if (options?.stack) {
            this.stack = `${peer.peerName}:${peer.selfName}\n${cause?.stack || options.stack}`;
        }
    }
}
function compileFunction(code, params, options) {
    params = params || [];
    const f = `(function(${params.join(',')}) {;${code};})`;
    return eval(f);
}
try {
    const fr = FinalizationRegistry;
}
catch (e) {
    window.WeakRef = class WeakRef {
        target;
        constructor(target) {
            this.target = target;
        }
        deref() {
            return this.target;
        }
    };
    window.FinalizationRegistry = class FinalizationRegistry {
        register() {
        }
    };
}
export class RpcPeer {
    selfName;
    peerName;
    send;
    idCounter = 1;
    onOob;
    params = {};
    pendingResults = {};
    proxyCounter = 1;
    localProxied = new Map();
    localProxyMap = {};
    remoteWeakProxies = {};
    finalizers = new FinalizationRegistry(entry => this.finalize(entry));
    nameDeserializerMap = new Map();
    constructorSerializerMap = new Map();
    transportSafeArgumentTypes = RpcPeer.getDefaultTransportSafeArgumentTypes();
    static finalizerIdSymbol = Symbol('rpcFinalizerId');
    static getDefaultTransportSafeArgumentTypes() {
        const jsonSerializable = new Set();
        jsonSerializable.add(Number.name);
        jsonSerializable.add(String.name);
        jsonSerializable.add(Object.name);
        jsonSerializable.add(Boolean.name);
        jsonSerializable.add(Array.name);
        return jsonSerializable;
    }
    static handleFunctionInvocations(thiz, target, p, receiver) {
        if (p === 'apply') {
            return (thisArg, args) => {
                return thiz.apply(target, thiz, args);
            };
        }
        else if (p === 'call') {
            return (thisArg, ...args) => {
                return thiz.apply(target, thiz, args);
            };
        }
        else if (p === 'toString' || p === Symbol.toPrimitive) {
            return (thisArg, ...args) => {
                return thiz.toPrimitive();
            };
        }
    }
    static PROPERTY_PROXY_ONEWAY_METHODS = '__proxy_oneway_methods';
    static PROPERTY_JSON_DISABLE_SERIALIZATION = '__json_disable_serialization';
    static PROPERTY_PROXY_PROPERTIES = '__proxy_props';
    static PROPERTY_JSON_COPY_SERIALIZE_CHILDREN = '__json_copy_serialize_children';
    constructor(selfName, peerName, send) {
        this.selfName = selfName;
        this.peerName = peerName;
        this.send = send;
    }
    createPendingResult(cb) {
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
    kill(message) {
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
    addSerializer(ctr, name, serializer) {
        this.nameDeserializerMap.set(name, serializer);
        this.constructorSerializerMap.set(ctr, name);
    }
    finalize(entry) {
        delete this.remoteWeakProxies[entry.id];
        const rpcFinalize = {
            __local_proxy_id: entry.id,
            __local_proxy_finalizer_id: entry.finalizerId,
            type: 'finalize',
        };
        this.send(rpcFinalize);
    }
    async getParam(param) {
        return this.createPendingResult((id, reject) => {
            const paramMessage = {
                id,
                type: 'param',
                param,
            };
            this.send(paramMessage, reject);
        });
    }
    sendOob(oob) {
        this.send({
            type: 'oob',
            oob,
        });
    }
    evalLocal(script, filename, coercedParams) {
        const params = Object.assign({}, this.params, coercedParams);
        let compile;
        try {
            compile = require('vm').compileFunction;
            ;
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
    createErrorResult(result, e) {
        result.stack = e.stack || 'no stack';
        result.result = e.name || 'no name';
        result.message = e.message || 'no message';
    }
    deserialize(value) {
        if (!value)
            return value;
        const copySerializeChildren = value[RpcPeer.PROPERTY_JSON_COPY_SERIALIZE_CHILDREN];
        if (copySerializeChildren) {
            const ret = {};
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
            proxy[RpcPeer.finalizerIdSymbol] = __remote_proxy_finalizer_id;
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
            return deserializer.deserialize(__serialized_value);
        }
        return value;
    }
    serialize(value) {
        if (value?.[RpcPeer.PROPERTY_JSON_COPY_SERIALIZE_CHILDREN] === true) {
            const ret = {};
            for (const [key, val] of Object.entries(value)) {
                ret[key] = this.serialize(val);
            }
            return ret;
        }
        if (!value || (!value[RpcPeer.PROPERTY_JSON_DISABLE_SERIALIZATION] && this.transportSafeArgumentTypes.has(value.constructor?.name))) {
            return value;
        }
        let __remote_constructor_name = value.__proxy_constructor || value.constructor?.name?.toString();
        let proxiedEntry = this.localProxied.get(value);
        if (proxiedEntry) {
            const __remote_proxy_finalizer_id = (this.proxyCounter++).toString();
            proxiedEntry.finalizerId = __remote_proxy_finalizer_id;
            const ret = {
                __remote_proxy_id: proxiedEntry.id,
                __remote_proxy_finalizer_id,
                __remote_constructor_name,
                __remote_proxy_props: value?.[RpcPeer.PROPERTY_PROXY_PROPERTIES],
                __remote_proxy_oneway_methods: value?.[RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS],
            };
            return ret;
        }
        const { __proxy_id, __proxy_peer } = value;
        if (__proxy_id && __proxy_peer === this) {
            const ret = {
                __local_proxy_id: __proxy_id,
            };
            return ret;
        }
        const serializerMapName = this.constructorSerializerMap.get(value.constructor);
        if (serializerMapName) {
            __remote_constructor_name = serializerMapName;
            const serializer = this.nameDeserializerMap.get(serializerMapName);
            if (!serializer)
                throw new Error('serializer not found for ' + serializerMapName);
            const serialized = serializer.serialize(value);
            const ret = {
                __remote_proxy_id: undefined,
                __remote_proxy_finalizer_id: undefined,
                __remote_constructor_name,
                __remote_proxy_props: value?.[RpcPeer.PROPERTY_PROXY_PROPERTIES],
                __remote_proxy_oneway_methods: value?.[RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS],
                __serialized_value: serialized,
            };
            return ret;
        }
        const __remote_proxy_id = (this.proxyCounter++).toString();
        proxiedEntry = {
            id: __remote_proxy_id,
            finalizerId: __remote_proxy_id,
        };
        this.localProxied.set(value, proxiedEntry);
        this.localProxyMap[__remote_proxy_id] = value;
        const ret = {
            __remote_proxy_id,
            __remote_proxy_finalizer_id: __remote_proxy_id,
            __remote_constructor_name,
            __remote_proxy_props: value?.[RpcPeer.PROPERTY_PROXY_PROPERTIES],
            __remote_proxy_oneway_methods: value?.[RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS],
        };
        return ret;
    }
    newProxy(proxyId, proxyConstructorName, proxyProps, proxyOneWayMethods) {
        const localProxiedEntry = {
            id: proxyId,
            finalizerId: undefined,
        };
        const rpc = new RpcProxy(this, localProxiedEntry, proxyConstructorName, proxyProps, proxyOneWayMethods);
        const target = proxyConstructorName === 'Function' || proxyConstructorName === 'AsyncFunction' ? function () { } : rpc;
        const proxy = new Proxy(target, rpc);
        const weakref = new WeakRef(proxy);
        this.remoteWeakProxies[proxyId] = weakref;
        this.finalizers.register(rpc, localProxiedEntry);
        return proxy;
    }
    async handleMessage(message) {
        try {
            switch (message.type) {
                case 'param': {
                    const rpcParam = message;
                    const result = {
                        type: 'result',
                        id: rpcParam.id,
                        result: this.serialize(this.params[rpcParam.param])
                    };
                    this.send(result);
                    break;
                }
                case 'apply': {
                    const rpcApply = message;
                    const result = {
                        type: 'result',
                        id: rpcApply.id || '',
                    };
                    try {
                        const target = this.localProxyMap[rpcApply.proxyId];
                        if (!target)
                            throw new Error(`proxy id ${rpcApply.proxyId} not found`);
                        const args = [];
                        for (const arg of (rpcApply.args || [])) {
                            args.push(this.deserialize(arg));
                        }
                        let value;
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
                        // console.error('failure', rpcApply.method, e);
                        this.createErrorResult(result, e);
                    }
                    if (!rpcApply.oneway)
                        this.send(result);
                    break;
                }
                case 'result': {
                    const rpcResult = message;
                    const deferred = this.pendingResults[rpcResult.id];
                    delete this.pendingResults[rpcResult.id];
                    if (!deferred)
                        throw new Error(`unknown result ${rpcResult.id}`);
                    if (rpcResult.message || rpcResult.stack) {
                        const e = new RPCResultError(this, rpcResult.message || 'no message', undefined, {
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
                    const rpcFinalize = message;
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
                case 'oob': {
                    const rpcOob = message;
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
export function getEvalSource() {
    return `
    (() => {
        ${RpcProxy}

        ${RpcPeer}
    
        return {
            RpcPeer,
            RpcProxy,
        };
    })();
    `;
}
//# sourceMappingURL=rpc.js.map