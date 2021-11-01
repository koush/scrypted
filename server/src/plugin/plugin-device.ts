import { DeviceProvider, EventDetails, EventListenerOptions, EventListenerRegister, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceDescriptors, ScryptedInterfaceProperty } from "@scrypted/sdk/types";
import { ScryptedRuntime } from "../runtime";
import { PluginDevice } from "../db-types";
import { MixinProvider } from "@scrypted/sdk/types";
import { handleFunctionInvocations, PROPERTY_PROXY_ONEWAY_METHODS } from "../rpc";
import { getState } from "../state";
import { getDisplayType } from "../infer-defaults";
import { allInterfaceProperties, isValidInterfaceMethod, methodInterfaces } from "./descriptor";

interface MixinTable {
    mixinProviderId: string;
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
        const mixinTable = this.mixinTable;
        this.mixinTable = undefined;
        (async () => {
            for (const mixinEntry of (await mixinTable || [])) {
                if (!mixinEntry.mixinProviderId)
                    continue;
                (async () => {
                    const mixinProvider = this.scrypted.getDevice(mixinEntry.mixinProviderId) as ScryptedDevice & MixinProvider;
                    mixinProvider?.releaseMixin(this.id, await mixinEntry.proxy);
                })().catch(() => { });
            }
        })().catch(() => { });;
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
            const type = getDisplayType(pluginDevice);
            const allInterfaces: ScryptedInterface[] = getState(pluginDevice, ScryptedInterfaceProperty.providedInterfaces) || [];

            const mixinTable: MixinTable[] = [];
            mixinTable.unshift({
                mixinProviderId: undefined,
                interfaces: allInterfaces.slice(),
                proxy,
            })

            for (const mixinId of getState(pluginDevice, ScryptedInterfaceProperty.mixins) || []) {
                const mixinProvider = this.scrypted.getDevice(mixinId) as ScryptedDevice & MixinProvider;

                const wrappedHandler = new PluginDeviceProxyHandler(this.scrypted, this.id);
                wrappedHandler.mixinTable = Promise.resolve(mixinTable.slice());
                const wrappedProxy = new Proxy(wrappedHandler, wrappedHandler);

                try {
                    const interfaces = await mixinProvider.canMixin(type, allInterfaces) as any as ScryptedInterface[];
                    if (!interfaces) {
                        console.warn(`mixin provider ${mixinId} can no longer mixin ${this.id}`);
                        const mixins: string[] = getState(pluginDevice, ScryptedInterfaceProperty.mixins) || [];
                        this.scrypted.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.mixins, mixins.filter(mid => mid !== mixinId))
                        this.scrypted.datastore.upsert(pluginDevice);
                        continue;
                    }

                    const host = this.scrypted.getPluginHostForDeviceId(mixinId);
                    const deviceState = await host.remote.createDeviceState(this.id,
                        async (property, value) => this.scrypted.stateManager.setPluginDeviceState(pluginDevice, property, value));
                    const mixinProxy = await mixinProvider.getMixin(wrappedProxy, allInterfaces, deviceState);
                    if (!mixinProxy)
                        throw new Error(`mixin provider ${mixinId} did not return mixin for ${this.id}`);
                    allInterfaces.push(...interfaces);
                    proxy = mixinProxy;

                    mixinTable.unshift({
                        mixinProviderId: mixinId,
                        interfaces,
                        proxy,
                    })
                }
                catch (e) {
                    console.warn("mixin provider failure", mixinId, e);
                }
            }

            const mixinInterfaces = [...new Set(allInterfaces)].sort();
            this.scrypted.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.interfaces, mixinInterfaces);

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
        // device may be deleted.
        if (!pluginDevice)
            return;
        const prop = p.toString();

        if (allInterfaceProperties.includes(prop))
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
        this.scrypted.stateManager.updateDescriptor(device);
    }
    async setRoom(room: string): Promise<void> {
        const device = this.scrypted.findPluginDeviceById(this.id);
        this.scrypted.stateManager.setPluginDeviceState(device, ScryptedInterfaceProperty.room, room);
        this.scrypted.stateManager.updateDescriptor(device);
    }
    async setType(type: ScryptedDeviceType): Promise<void> {
        const device = this.scrypted.findPluginDeviceById(this.id);
        this.scrypted.stateManager.setPluginDeviceState(device, ScryptedInterfaceProperty.type, type);
        this.scrypted.stateManager.updateDescriptor(device);
    }

    async applyMixin(method: string, argArray?: any): Promise<any> {
        const iface = methodInterfaces[method];
        if (!iface)
            throw new Error(`unknown method ${method}`);

        const mixinTable = await this.mixinTable;
        for (const mixin of mixinTable) {

            // this could be null?
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
