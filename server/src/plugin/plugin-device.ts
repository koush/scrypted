import { DeviceProvider, EventDetails, EventListenerOptions, EventListenerRegister, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceDescriptors, ScryptedInterfaceProperty } from "@scrypted/sdk/types";
import { ScryptedRuntime } from "../runtime";
import { ScryptedDocument } from "../db-types";
import { SystemDeviceState, MixinProvider } from "@scrypted/sdk/types";
import { handleFunctionInvocations } from "../rpc";
import { getState } from "../state";
import { getProvidedTypeOrDefault } from "../infer-defaults";
import { hasSameElements } from "../collection";
import { textChangeRangeIsUnchanged } from "typescript";

export const allInterfaceMethods: any[] = [].concat(...Object.values(ScryptedInterfaceDescriptors).map((type: any) => type.methods));
export const allInterfaceProperties: any[] = [].concat(...Object.values(ScryptedInterfaceDescriptors).map((type: any) => type.properties));
export const deviceMethods: any[] = ['listen', 'setName', 'setRoom', 'setType'];

const methodInterfaces: { [method: string]: string } = {};
for (const desc of Object.values(ScryptedInterfaceDescriptors)) {
    for (const method of desc.methods) {
        methodInterfaces[method] = desc.name;
    }
}

export function isValidInterfaceMethod(interfaces: string[], method: string) {
    const availableMethods: any[] = [].concat(...Object.values(ScryptedInterfaceDescriptors).filter((e: any) => interfaces.includes(e.name)).map((type: any) => type.methods));
    return availableMethods.includes(method) || ScryptedInterfaceDescriptors[ScryptedInterface.ScryptedDevice].methods.includes(method);
}

export function isValidInterfaceProperty(interfaces: string[], property: string): boolean {
    const availableProperties: any[] = [].concat(...Object.values(ScryptedInterfaceDescriptors).filter((e: any) => interfaces.includes(e.name)).map((type: any) => type.properties));
    return availableProperties.includes(property);
}

export class PluginDevice extends ScryptedDocument {
    constructor(id?: string) {
        super();
        this._id = id;
    }
    nativeId?: string;
    pluginId: string;
    state: { [property: string]: SystemDeviceState };
    stateVersion: number;
    storage: { [key: string]: string };
    mixins: string[];
}

interface MixinTable {
    interfaces: string[];
    proxy: Promise<any>;
}

export class PluginDeviceProxyHandler implements ProxyHandler<any>, ScryptedDevice {
    scrypted: ScryptedRuntime;
    id: string;
    // proxy: Promise<any>;
    mixinTable: Promise<MixinTable[]>;

    constructor(scrypted: ScryptedRuntime, id: string) {
        this.scrypted = scrypted;
        this.id = id;
    }

    invalidate() {
        this.mixinTable = undefined;
    }

    ensureProxy(): Promise<PluginDevice> {
        const pluginDevice = this.scrypted.findPluginDeviceById(this.id);
        if (!pluginDevice)
            throw new Error(`device ${this.id} does not exist`);

        if (this.mixinTable)
            return Promise.resolve(pluginDevice);

        this.mixinTable = (async () => {
            let proxy: any;
            if (!pluginDevice.nativeId) {
                const plugin = this.scrypted.plugins[pluginDevice.pluginId];
                proxy = await plugin.module;
            }
            else {
                const providerId = getState(pluginDevice, ScryptedInterfaceProperty.providerId);
                const provider = this.scrypted.getDevice(providerId) as ScryptedDevice & DeviceProvider;
                proxy = await provider.getDevice(pluginDevice.nativeId);
            }

            if (!proxy)
                console.error('null proxy', this.id);
            // after creating an actual device, apply all the mixins
            const type = getProvidedTypeOrDefault(pluginDevice);
            const allInterfaces: ScryptedInterface[] = getState(pluginDevice, ScryptedInterfaceProperty.providedInterfaces) || [];

            const mixinTable: MixinTable[] = [];
            mixinTable.unshift({
                interfaces: allInterfaces.slice(),
                proxy,
            })

            for (const mixinId of pluginDevice.mixins || []) {
                const mixin = this.scrypted.getDevice(mixinId) as ScryptedDevice & MixinProvider;

                const wrappedHandler = new PluginDeviceProxyHandler(this.scrypted, this.id);
                wrappedHandler.mixinTable = Promise.resolve(mixinTable.slice());
                const wrappedProxy = new Proxy(wrappedHandler, wrappedHandler);

                try {
                    const interfaces = await (mixin.canMixin(type, allInterfaces) as any) as ScryptedInterface[];
                    if (!interfaces)
                        throw new Error(`mixin provider ${mixinId} can no longer mixin ${this.id}`);

                    const host = this.scrypted.getPluginHostForDeviceId(mixinId);
                    const deviceState = await host.remote.createDeviceState(this.id,
                        async (property, value) => this.scrypted.stateManager.setPluginDeviceState(pluginDevice, property, value));
                    const mixinProxy = await mixin.getMixin(wrappedProxy, deviceState);
                    if (!mixinProxy)
                        throw new Error(`mixin provider ${mixinId} did not return mixin for ${this.id}`);
                    allInterfaces.push(...interfaces);
                    proxy = mixinProxy;

                    mixinTable.unshift({
                        interfaces,
                        proxy,
                    })
                }
                catch (e) {
                    console.warn("mixing provider failure", e);
                }
            }

            // mixins may have modified the interfaces by being added, removed, or crashed.
            // update the interface property only if necessary.
            const previousInterfaces: ScryptedInterface[] = getState(pluginDevice, ScryptedInterfaceProperty.interfaces) || [];
            if (!hasSameElements(allInterfaces, previousInterfaces)) {
                this.scrypted.stateManager.setPluginDeviceState(pluginDevice,
                    ScryptedInterfaceProperty.interfaces,
                    [... new Set(allInterfaces)]);
            }

            return mixinTable;
        })();

        return this.mixinTable.then(mixinTable => pluginDevice);
    }

    get(target: any, p: PropertyKey, receiver: any): any {
        if (p === 'constructor')
            return;
        const handled = handleFunctionInvocations(this, target, p, receiver);
        if (handled)
            return handled;
        const pluginDevice = this.scrypted.findPluginDeviceById(this.id);
        const prop = p.toString();

        if (allInterfaceProperties.includes(p))
            return getState(pluginDevice, prop);

        if (p === RefreshSymbol)
            return new Proxy(() => p, this);

        if (!isValidInterfaceMethod(pluginDevice.state.interfaces.value, prop))
            return;

        if (ScryptedInterfaceDescriptors[ScryptedInterface.ScryptedDevice].methods.includes(prop))
            return (this as any)[p].bind(this);

        return new Proxy(() => prop, this);
    }

    listen(event: string | EventListenerOptions, callback: (eventSource: ScryptedDevice, eventDetails: EventDetails, eventData: object) => void): EventListenerRegister {
        return this.scrypted.stateManager.listenDevice(this.id, event, (eventDetails, eventData) => callback(this.scrypted.getDevice(this.id), eventDetails, eventData));
    }
    async setName(name: string): Promise<void> {
        const device = this.scrypted.findPluginDeviceById(this.id);
        this.scrypted.stateManager.setPluginDeviceState(device, ScryptedInterfaceProperty.name, name);
    }
    async setRoom(room: string): Promise<void> {
        const device = this.scrypted.findPluginDeviceById(this.id);
        this.scrypted.stateManager.setPluginDeviceState(device, ScryptedInterfaceProperty.room, room);
    }
    async setType(type: ScryptedDeviceType): Promise<void> {
        const device = this.scrypted.findPluginDeviceById(this.id);
        this.scrypted.stateManager.setPluginDeviceState(device, ScryptedInterfaceProperty.type, type);
    }

    async applyMixin(method: string, argArray?: any): Promise<any> {
        const iface = methodInterfaces[method];
        if (!iface)
            throw new Error(`unknown method ${method}`);

        for (const mixin of await this.mixinTable) {

            if (mixin.interfaces.includes(iface))
                return (await mixin.proxy)[method](...argArray);
        }

        throw new Error(`${method} not implemented`)
    }

    async apply(target: any, thisArg: any, argArray?: any): Promise<any> {
        const method = target();

        const pluginDevice = await this.ensureProxy();

        if (method === RefreshSymbol)
            return this.applyMixin('refresh', argArray);

        if (!isValidInterfaceMethod(pluginDevice.state.interfaces.value, method))
            throw new Error(`device ${this.id} does not support method ${method}`);

        if (method === 'refresh') {
            const refreshInterface = argArray[0];
            const userInitiated = argArray[1];
            return this.scrypted.stateManager.refresh(this.id, refreshInterface, userInitiated);
        }

        return this.applyMixin(method, argArray);
    }
}

export const RefreshSymbol = Symbol('ScryptedDeviceRefresh');
