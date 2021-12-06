import { DeviceProvider, EventDetails, EventListenerOptions, EventListenerRegister, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceDescriptors, ScryptedInterfaceProperty } from "@scrypted/sdk/types";
import { ScryptedRuntime } from "../runtime";
import { PluginDevice } from "../db-types";
import { MixinProvider } from "@scrypted/sdk/types";
import { handleFunctionInvocations } from "../rpc";
import { getState } from "../state";
import { getDisplayType } from "../infer-defaults";
import { allInterfaceProperties, isValidInterfaceMethod, methodInterfaces } from "./descriptor";

interface MixinTable {
    mixinProviderId: string;
    entry: Promise<MixinTableEntry>;
}

interface MixinTableEntry {
    interfaces: Set<string>
    allInterfaces: string[];
    proxy: any;
    error?: Error;
}

export class PluginDeviceProxyHandler implements ProxyHandler<any>, ScryptedDevice {
    scrypted: ScryptedRuntime;
    id: string;
    mixinTable: MixinTable[];

    constructor(scrypted: ScryptedRuntime, id: string) {
        this.scrypted = scrypted;
        this.id = id;
    }

    invalidateEntry(mixinEntry: MixinTable) {
        if (!mixinEntry.mixinProviderId)
            return;
        (async () => {
            const mixinProvider = this.scrypted.getDevice(mixinEntry.mixinProviderId) as ScryptedDevice & MixinProvider;
            const { proxy } = await mixinEntry.entry;
            mixinProvider?.releaseMixin(this.id, proxy);
        })().catch(() => { });
    }

    // should this be async?
    invalidate() {
        const mixinTable = this.mixinTable;
        this.mixinTable = undefined;
        for (const mixinEntry of (mixinTable || [])) {
            this.invalidateEntry(mixinEntry);
        }
    }

    invalidateMixinTable() {
        if (!this.mixinTable)
            return this.invalidate();

        let previousMixinIds = this.mixinTable?.map(entry => entry.mixinProviderId) || [];
        previousMixinIds.pop();
        previousMixinIds = previousMixinIds.reverse();

        const pluginDevice = this.scrypted.findPluginDeviceById(this.id);
        if (!pluginDevice)
            return this.invalidate();

        const mixins = getState(pluginDevice, ScryptedInterfaceProperty.mixins) || [];
        // iterate the new mixin table to find the last good mixin,
        // and resume creation from there.
        let lastValidMixinId: string;
        for (const mixinId of mixins) {
            if (!previousMixinIds.length) {
                // reached of the previous mixin table, meaning
                // mixins were added.
                break;
            }
            const check = previousMixinIds.shift();
            if (check !== mixinId)
                break;

            lastValidMixinId = mixinId;
        }

        if (!lastValidMixinId)
            return this.invalidate();

        // invalidate and remove everything up to lastValidMixinId
        while (true) {
            const entry = this.mixinTable[0];
            if (entry.mixinProviderId === lastValidMixinId)
                break;
            this.mixinTable.shift();
            this.invalidateEntry(entry);
        }

        this.ensureProxy(lastValidMixinId);
    }

    // this must not be async, because it potentially changes execution order.
    ensureProxy(lastValidMixinId?: string): Promise<PluginDevice> {
        const pluginDevice = this.scrypted.findPluginDeviceById(this.id);
        if (!pluginDevice)
            throw new Error(`device ${this.id} does not exist`);

        let previousEntry: Promise<MixinTableEntry>;
        if (!lastValidMixinId) {
            if (this.mixinTable)
                return Promise.resolve(pluginDevice);

            this.mixinTable = [];

            previousEntry = (async () => {
                let proxy;
                try {
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
                        console.warn('no device was returned by the plugin', this.id);
                }
                catch (e) {
                    console.warn('error occured retrieving device from plugin');
                }

                const interfaces: ScryptedInterface[] = getState(pluginDevice, ScryptedInterfaceProperty.providedInterfaces) || [];
                return {
                    proxy,
                    interfaces: new Set<string>(interfaces),
                    allInterfaces: interfaces,
                }
            })();

            this.mixinTable.unshift({
                mixinProviderId: undefined,
                entry: previousEntry,
            });
        }
        else {
            if (!this.mixinTable)
                throw new Error('mixin table partial invalidation was called with empty mixin table');
            const prevTable = this.mixinTable.find(table => table.mixinProviderId === lastValidMixinId);
            if (!prevTable)
                throw new Error('mixin table partial invalidation was called with invalid lastValidMixinId');
            previousEntry = prevTable.entry;
        }

        const type = getDisplayType(pluginDevice);

        for (const mixinId of getState(pluginDevice, ScryptedInterfaceProperty.mixins) || []) {
            if (lastValidMixinId) {
                if (mixinId === lastValidMixinId)
                    lastValidMixinId = undefined;
                continue;
            }

            const wrappedMixinTable = this.mixinTable.slice();

            this.mixinTable.unshift({
                mixinProviderId: mixinId,
                entry: (async () => {
                    let { allInterfaces } = await previousEntry;
                    try {
                        const mixinProvider = this.scrypted.getDevice(mixinId) as ScryptedDevice & MixinProvider;
                        const interfaces = await mixinProvider?.canMixin(type, allInterfaces) as any as ScryptedInterface[];
                        if (!interfaces) {
                            // this is not an error
                            // do not advertise interfaces so it is skipped during
                            // vtable lookup.
                            console.log(`mixin provider ${mixinId} can no longer mixin ${this.id}`);
                            const mixins: string[] = getState(pluginDevice, ScryptedInterfaceProperty.mixins) || [];
                            this.scrypted.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.mixins, mixins.filter(mid => mid !== mixinId))
                            this.scrypted.datastore.upsert(pluginDevice);
                            return {
                                allInterfaces,
                                interfaces: new Set<string>(),
                                proxy: undefined as any,
                            };
                        }

                        allInterfaces = allInterfaces.slice();
                        allInterfaces.push(...interfaces);
                        const combinedInterfaces = [...new Set(allInterfaces)];

                        const wrappedHandler = new PluginDeviceProxyHandler(this.scrypted, this.id);
                        wrappedHandler.mixinTable = wrappedMixinTable;
                        const wrappedProxy = new Proxy(wrappedHandler, wrappedHandler);

                        const host = this.scrypted.getPluginHostForDeviceId(mixinId);
                        const deviceState = await host.remote.createDeviceState(this.id,
                            async (property, value) => this.scrypted.stateManager.setPluginDeviceState(pluginDevice, property, value));
                        const mixinProxy = await mixinProvider.getMixin(wrappedProxy, allInterfaces as ScryptedInterface[], deviceState);
                        if (!mixinProxy)
                            throw new Error(`mixin provider ${mixinId} did not return mixin for ${this.id}`);

                        return {
                            interfaces: new Set<string>(interfaces),
                            allInterfaces: combinedInterfaces,
                            proxy: mixinProxy,
                        };
                    }
                    catch (e) {
                        // on any error, do not advertise interfaces
                        // on this mixin, so as to prevent total failure?
                        // this has been the behavior for a while,
                        // but maybe interfaces implemented by that mixin
                        // should rethrow the error caught here in applyMixin.
                        console.warn(e);
                        return {
                            allInterfaces,
                            interfaces: new Set<string>(),
                            error: e,
                            proxy: undefined as any,
                        };
                    }
                })(),
            });
        }

        return this.mixinTable[0].entry.then(entry => {
            this.scrypted.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.interfaces, entry.allInterfaces);
            return pluginDevice;
        });
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

    async probe(): Promise<boolean> {
        try {
            await this.ensureProxy();
            return true;
        }
        catch (e) {
            return false;
        }
    }

    async applyMixin(method: string, argArray?: any): Promise<any> {
        const iface = methodInterfaces[method];
        if (!iface)
            throw new Error(`unknown method ${method}`);

        for (const mixin of this.mixinTable) {
            const { interfaces, proxy } = await mixin.entry;
            // this could be null?
            if (interfaces.has(iface)) {
                if (!proxy)
                    throw new Error(`device is unavailable ${this.id} (mixin ${mixin.mixinProviderId})`);
                return proxy[method](...argArray);
            }
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

        if (method === 'createDevice') {
            const nativeId = await this.applyMixin(method, argArray);
            const newDevice = this.scrypted.findPluginDevice(pluginDevice.pluginId, nativeId);
            return newDevice._id;
        }

        return this.applyMixin(method, argArray);
    }
}

export const RefreshSymbol = Symbol('ScryptedDeviceRefresh');
