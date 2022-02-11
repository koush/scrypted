import { EventListenerOptions, EventDetails, EventListenerRegister, ScryptedDevice, ScryptedInterface, ScryptedInterfaceDescriptors, SystemDeviceState, SystemManager, ScryptedInterfaceProperty, ScryptedDeviceType, Logger } from "@scrypted/types";
import { PluginAPI } from "./plugin-api";
import { handleFunctionInvocations, PrimitiveProxyHandler, PROPERTY_PROXY_ONEWAY_METHODS } from '../rpc';
import { EventRegistry } from "../event-registry";
import { allInterfaceProperties, isValidInterfaceMethod } from "./descriptor";


function newDeviceProxy(id: string, systemManager: SystemManagerImpl) {
    const handler = new DeviceProxyHandler(id, systemManager);
    return new Proxy(handler, handler);
}


class DeviceProxyHandler implements PrimitiveProxyHandler<any>, ScryptedDevice {
    device: Promise<ScryptedDevice>;
    constructor(public id: string, public systemManager: SystemManagerImpl) {
    }

    toPrimitive() {
        return `ScryptedDevice-${this.id}`
    }

    get(target: any, p: PropertyKey, receiver: any): any {
        if (p === 'id')
            return this.id;

        const handled = handleFunctionInvocations(this, target, p, receiver);
        if (handled)
            return handled;

        if (allInterfaceProperties.includes(p.toString()))
            return (this.systemManager.state[this.id] as any)?.[p]?.value;

        const prop = p.toString();
        if (!isValidInterfaceMethod(this.systemManager.state[this.id].interfaces.value, prop))
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
        if (false && method === 'refresh') {
            const name = this.systemManager.state[this.id]?.[ScryptedInterfaceProperty.name].value;
            this.systemManager.log.i(`requested refresh ${name}`);
        }
        return (device as any)[method](...argArray);
    }

    listen(event: string | EventListenerOptions, callback: (eventSource: ScryptedDevice, eventDetails: EventDetails, eventData: any) => void): EventListenerRegister {
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
    const oneways: string[] = f[PROPERTY_PROXY_ONEWAY_METHODS] || [];
    if (!oneways.includes(null))
        oneways.push(null);
    f[PROPERTY_PROXY_ONEWAY_METHODS] = oneways;
    return input;
}

export class SystemManagerImpl implements SystemManager {
    api: PluginAPI;
    state: {[id: string]: {[property: string]: SystemDeviceState}};
    deviceProxies: {[id: string]: ScryptedDevice} = {};
    log: Logger;
    events = new EventRegistry();

    getDeviceState(id: string) {
        return this.state[id];
    }
    getSystemState(): {[id: string]: {[property: string]: SystemDeviceState}} {
        return this.state;
    }

    getDeviceById(id: string): any {
        if (!this.state[id])
            return;
        let proxy = this.deviceProxies[id];
        if (!proxy)
            proxy = this.deviceProxies[id] = newDeviceProxy(id, this);
        return proxy;
    }

    getDeviceByName(name: string): any {
        for (const id of Object.keys(this.state)) {
            const s = this.state[id];
            if (s.name.value === name)
                return this.getDeviceById(id);
        }
    }
    listen(callback: (eventSource: ScryptedDevice, eventDetails: EventDetails, eventData: any) => void): EventListenerRegister {
        return this.events.listen(makeOneWayCallback((id, eventDetails, eventData) => callback(this.getDeviceById(id), eventDetails, eventData)));
    }
    listenDevice(id: string, options: string | EventListenerOptions, callback: (eventSource: ScryptedDevice, eventDetails: EventDetails, eventData: any) => void): EventListenerRegister {
        let { event, watch } = (options || {}) as EventListenerOptions;
        if (!event && typeof options === 'string')
            event = options as string;
        if (!event)
            event = undefined;

        // passive watching can be fast pathed to observe local state
        if (watch)
            return this.events.listenDevice(id, event, (eventDetails, eventData) => callback(this.getDeviceById(id), eventDetails, eventData));

        return new EventListenerRegisterImpl(this.api.listenDevice(id, options, makeOneWayCallback((eventDetails, eventData) => callback(this.getDeviceById(id), eventDetails, eventData))));
    }

    async removeDevice(id: string) {
        return this.api.removeDevice(id);
    }

    getComponent(id: string): Promise<any> {
        return this.api.getComponent(id);
    }
}
