import { EventListener, EventListenerOptions, EventListenerRegister, Logger, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceDescriptor, ScryptedInterfaceDescriptors, ScryptedInterfaceProperty, ScryptedNativeId, SystemDeviceState, SystemManager } from "@scrypted/types";
import { EventRegistry } from "../event-registry";
import { PrimitiveProxyHandler, RpcPeer } from '../rpc';
import { getInterfaceMethods, getInterfaceProperties, getPropertyInterfaces, isValidInterfaceMethod, propertyInterfaces } from "./descriptor";
import { PluginAPI } from "./plugin-api";

function newDeviceProxy(id: string, systemManager: SystemManagerImpl) {
    const handler = new DeviceProxyHandler(id, systemManager);
    return new Proxy(handler, handler);
}

class DeviceProxyHandler implements PrimitiveProxyHandler<any> {
    customProperties: Map<string | number | symbol, any>;
    device: Promise<ScryptedDevice>;
    constructor(public id: string, public systemManager: SystemManagerImpl) {
    }

    toPrimitive() {
        return `ScryptedDevice-${this.id}`
    }

    ownKeys(target: any): ArrayLike<string | symbol> {
        const interfaces = new Set<string>(this.systemManager.state[this.id].interfaces.value);
        const methods = getInterfaceMethods(this.systemManager.descriptors || ScryptedInterfaceDescriptors, interfaces);
        const properties = getInterfaceProperties(this.systemManager.descriptors || ScryptedInterfaceDescriptors, interfaces);
        return [...methods, ...properties];
    }

    getOwnPropertyDescriptor(target: any, p: string | symbol): PropertyDescriptor {
        const interfaces = new Set<string>(this.systemManager.state[this.id].interfaces.value);
        const methods = getInterfaceMethods(this.systemManager.descriptors || ScryptedInterfaceDescriptors, interfaces);
        const prop = p.toString();
        if (methods.includes(prop)) {
            return {
                configurable: true,
            };
        }
        const properties = getInterfaceProperties(this.systemManager.descriptors || ScryptedInterfaceDescriptors, interfaces);
        if (properties.includes(prop)) {
            return {
                configurable: true,
                value: this.systemManager.state[this.id][prop]?.value
            }
        }
    }

    deleteProperty(target: any, p: string | symbol): boolean {
        const prop = p.toString();
        if (Object.keys(ScryptedInterfaceProperty).includes(prop))
            return false;

        this.customProperties ||= new Map();
        this.customProperties.set(p, undefined);
        return true;
    }

    set(target: any, p: string | symbol, newValue: any, receiver: any): boolean {
        const prop = p.toString();
        if (Object.keys(ScryptedInterfaceProperty).includes(prop))
            return false;

        this.customProperties ||= new Map();
        this.customProperties.set(p, newValue);

        return true;
    }

    get(target: any, p: PropertyKey, receiver: any): any {
        if (p === 'id')
            return this.id;

        if (this.customProperties?.has(p))
            return this.customProperties.get(p);

        const handled = RpcPeer.handleFunctionInvocations(this, target, p, receiver);
        if (handled)
            return handled;

        const interfaces = new Set<string>(this.systemManager.state[this.id].interfaces?.value || []);
        const prop = p.toString();
        const isValidProperty = this.systemManager.propertyInterfaces?.[prop] || propertyInterfaces[prop];

        // this will also return old properties that should not exist on a device. ie, a disabled mixin provider.
        // should this change?
        if (isValidProperty)
            return (this.systemManager.state[this.id] as any)?.[p]?.value;

        if (!isValidInterfaceMethod(this.systemManager.descriptors || ScryptedInterfaceDescriptors, interfaces, prop))
            return;

        if (ScryptedInterfaceDescriptors[ScryptedInterface.ScryptedDevice].methods.includes(prop))
            return (this as any)[p].bind(this);

        return new Proxy(() => p, this);
    }

    ensureDevice() {
        if (!this.device)
            this.device = this.systemManager.api.getDeviceById(this.id);
        return this.device;
    }

    async apply(target: any, thisArg: any, argArray?: any) {
        const method = target();
        const device = await this.ensureDevice();
        return (device as any)[method](...argArray);
    }

    listen(event: string | EventListenerOptions, callback: EventListener): EventListenerRegister {
        return this.systemManager.listenDevice(this.id, event, callback);
    }

    async setName(name: string): Promise<void> {
        return this.systemManager.api.setDeviceProperty(this.id, ScryptedInterfaceProperty.name, name);
    }
    async setRoom(room: string): Promise<void> {
        return this.systemManager.api.setDeviceProperty(this.id, ScryptedInterfaceProperty.room, room);
    }
    async setType(type: ScryptedDeviceType): Promise<void> {
        return this.systemManager.api.setDeviceProperty(this.id, ScryptedInterfaceProperty.type, type);
    }

    async setMixins(mixins: string[]) {
        const plugins = await this.systemManager.getComponent('plugins');// as PluginComponent;
        await plugins.setMixins(this.id, mixins);
    }

    async probe(): Promise<boolean> {
        return this.apply(() => 'probe', undefined, []);
    }
}


class EventListenerRegisterImpl implements EventListenerRegister {
    promise: Promise<EventListenerRegister>;
    constructor(promise: Promise<EventListenerRegister>) {
        this.promise = promise;
    }
    async removeListener(): Promise<void> {
        try {
            const register = await this.promise;
            this.promise = undefined;
            register?.removeListener();
        }
        catch (e) {
            console.error('removeListener', e);
        }
    }
}

function makeOneWayCallback<T>(input: T): T {
    const f: any = input;
    const oneways: string[] = f[RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS] || [];
    if (!oneways.includes(null))
        oneways.push(null);
    f[RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS] = oneways;
    return input;
}

export class SystemManagerImpl implements SystemManager {
    api: PluginAPI;
    state: { [id: string]: { [property: string]: SystemDeviceState } };
    deviceProxies: { [id: string]: ScryptedDevice } = {};
    log: Logger;
    events = new EventRegistry();
    typesVersion: string;
    descriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor };
    propertyInterfaces: ReturnType<typeof getPropertyInterfaces>;

    getDeviceState(id: string) {
        return this.state[id];
    }
    getSystemState(): { [id: string]: { [property: string]: SystemDeviceState } } {
        return this.state;
    }

    getDeviceById(idOrPluginId: string, nativeId?: ScryptedNativeId): any {
        let id: string;
        if (this.state[idOrPluginId]) {
            // don't allow invalid input on nativeId, must be nullish if there is an exact id match.
            if (nativeId != null)
                return;
            id = idOrPluginId;
        }
        else {
            for (const check of Object.keys(this.state)) {
                const state = this.state[check];
                if (!state)
                    continue;
                if (state[ScryptedInterfaceProperty.pluginId]?.value === idOrPluginId) {
                    // null and undefined should match here.
                    if (state[ScryptedInterfaceProperty.nativeId]?.value == nativeId) {
                        id = check;
                        break;
                    }
                }
            }
        }
        if (!id)
            return;
        let proxy = this.deviceProxies[id];
        if (!proxy)
            proxy = this.deviceProxies[id] = newDeviceProxy(id, this);
        return proxy;
    }

    getDeviceByName(name: string): any {
        for (const id of Object.keys(this.state)) {
            const s = this.state[id];
            if ((s.interfaces?.value as string[])?.includes(ScryptedInterface.ScryptedPlugin) && s.pluginId?.value === name)
                return this.getDeviceById(id);
            if (s.name.value === name)
                return this.getDeviceById(id);
        }
    }
    listen(callback: EventListener): EventListenerRegister {
        return this.events.listen(makeOneWayCallback((id, eventDetails, eventData) => callback(this.getDeviceById(id), eventDetails, eventData)));
    }
    listenDevice(id: string, options: string | EventListenerOptions, callback: EventListener): EventListenerRegister {
        let { watch } = (options || {}) as EventListenerOptions;

        // passive watching can be fast pathed to observe local state
        if (watch)
            return this.events.listenDevice(id, options, (eventDetails, eventData) => callback(this.getDeviceById(id), eventDetails, eventData));

        return new EventListenerRegisterImpl(this.api.listenDevice(id, options, makeOneWayCallback((eventDetails, eventData) => callback(this.getDeviceById(id), eventDetails, eventData))));
    }

    async removeDevice(id: string) {
        return this.api.removeDevice(id);
    }

    getComponent(id: string): Promise<any> {
        return this.api.getComponent(id);
    }

    setScryptedInterfaceDescriptors(typesVersion: string, descriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor }): Promise<void> {
        this.typesVersion = typesVersion;
        this.descriptors = descriptors;
        this.propertyInterfaces = getPropertyInterfaces(descriptors);
        return this.api.setScryptedInterfaceDescriptors(typesVersion, descriptors);
    }
}
