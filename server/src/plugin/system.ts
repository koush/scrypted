import { EventListenerOptions, EventDetails, EventListenerRegister, ScryptedDevice, ScryptedInterface, ScryptedInterfaceDescriptors, SystemDeviceState, SystemManager, ScryptedInterfaceProperty, ScryptedDeviceType, Logger } from "@scrypted/sdk/types";
import { PluginAPI } from "./plugin-api";
import { handleFunctionInvocations } from '../rpc';
import { allInterfaceProperties, isValidInterfaceMethod } from './plugin-device';
import { EventRegistry } from "../event-registry";


function newDeviceProxy(id: string, systemManager: SystemManagerImpl) {
    const handler = new DeviceProxyHandler(id, systemManager);
    return new Proxy(handler, handler);
}


class DeviceProxyHandler implements ProxyHandler<any>, ScryptedDevice {
    device: ScryptedDevice;
    id: string;
    systemManager: SystemManagerImpl;
    constructor(id: string, systemManager: SystemManagerImpl) {
        this.id = id;
        this.systemManager = systemManager;
    }

    get(target: any, p: PropertyKey, receiver: any): any {
        if (p === 'id')
            return this.id;

        const handled = handleFunctionInvocations(this, target, p, receiver);
        if (handled)
            return handled;

        if (allInterfaceProperties.includes(p))
            return (this.systemManager.state[this.id] as any)?.[p]?.value;

        const prop = p.toString();
        if (!isValidInterfaceMethod(this.systemManager.state[this.id].interfaces.value, prop))
            return;

        if (ScryptedInterfaceDescriptors[ScryptedInterface.ScryptedDevice].methods.includes(prop))
            return (this as any)[p].bind(this);

        return new Proxy(() => p, this);
    }

    async apply(target: any, thisArg: any, argArray?: any) {
        const method = target();
        if (!this.device)
            this.device = await this.systemManager.api.getDeviceById(this.id);
        if (method === 'refresh') {
            const name = this.systemManager.state[this.id]?.[ScryptedInterfaceProperty.name].value;
            this.systemManager.log.i(`requested refresh ${name}`);
        }
        return (this.device as any)[method](...argArray);
    }

    listen(event: string | EventListenerOptions, callback: (eventSource: ScryptedDevice, eventDetails: EventDetails, eventData: object) => void): EventListenerRegister {
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
}


class EventListenerRegisterImpl implements EventListenerRegister {
    promise: Promise<EventListenerRegister>;
    constructor(promise: Promise<EventListenerRegister>) {
        this.promise = promise;
    }
    async removeListener(): Promise<void> {
        try {
            const register = await this.promise;
            register.removeListener();
        }
        catch (e) {
            console.error('removeListener', e);
        }
    }
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

    getDeviceById(id: string): ScryptedDevice {
        if (!this.state[id])
            return;
        let proxy = this.deviceProxies[id];
        if (!proxy)
            proxy = this.deviceProxies[id] = newDeviceProxy(id, this);
        return proxy;
    }

    getDeviceByName(name: string): ScryptedDevice {
        for (const id of Object.keys(this.state)) {
            const s = this.state[id];
            if (s.name.value === name)
                return this.getDeviceById(id);
        }
    }
    listen(EventListener: (eventSource: ScryptedDevice, eventDetails: EventDetails, eventData: object) => void): EventListenerRegister {
        return this.events.listen((id, eventDetails, eventData) => EventListener(this.getDeviceById(id), eventDetails, eventData));
    }
    listenDevice(id: string, options: string | EventListenerOptions, callback: (eventSource: ScryptedDevice, eventDetails: EventDetails, eventData: object) => void): EventListenerRegister {
        let { event, watch } = (options || {}) as EventListenerOptions;
        if (!event && typeof options === 'string')
            event = options as string;
        if (!event)
            event = undefined;

        // passive watching can be fast pathed to observe local state
        if (watch)
            return this.events.listenDevice(id, event, (eventDetails, eventData) => callback(this.getDeviceById(id), eventDetails, eventData));

        return new EventListenerRegisterImpl(this.api.listenDevice(id, options, (eventDetails, eventData) => callback(this.getDeviceById(id), eventDetails, eventData)))
    }

    async removeDevice(id: string) {
        return this.api.removeDevice(id);
    }

    getComponent(id: string): Promise<any> {
        return this.api.getComponent(id);
    }
}
