import { DeviceProvider, EventListener, EventListenerOptions, EventListenerRegister, MixinProvider, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceDescriptors, ScryptedInterfaceProperty } from "@scrypted/types";
import fs from 'fs';
import path from 'path';
import { PluginDevice } from "../db-types";
import { getDisplayType } from "../infer-defaults";
import { PrimitiveProxyHandler, RpcPeer } from "../rpc";
import { ScryptedRuntime } from "../runtime";
import { sleep } from "../sleep";
import { getState } from "../state";
import { AccessControls } from "./acl";
import { allInterfaceProperties, getInterfaceMethods, getPropertyInterfaces } from "./descriptor";
import { PluginError } from "./plugin-error";

interface MixinTable {
    mixinProviderId: string;
    entry: Promise<MixinTableEntry>;
}

interface MixinTableEntry {
    interfaces: Set<string>;
    methods?: Set<string>;
    allInterfaces: string[];
    proxy: any;
    error?: Error;
    passthrough: boolean;
}

export const RefreshSymbol = Symbol('ScryptedDeviceRefresh');
export const QueryInterfaceSymbol = Symbol("ScryptedPluginDeviceQueryInterface");

export class PluginDeviceProxyHandler implements PrimitiveProxyHandler<any> {
    scrypted: ScryptedRuntime;
    id: string;
    mixinTable: MixinTable[];
    releasing = new Set<any>();

    static sortInterfaces(interfaces: string[]): string[] {
        return [...new Set(interfaces || [])].sort();
    }

    constructor(scrypted: ScryptedRuntime, id: string) {
        this.scrypted = scrypted;
        this.id = id;
    }

    toPrimitive() {
        return `PluginDevice-${this.id}`;
    }

    invalidateEntry(mixinEntry: MixinTable) {
        if (!mixinEntry?.mixinProviderId)
            return;
        (async () => {
            const mixinProvider = this.scrypted.getDevice(mixinEntry.mixinProviderId) as ScryptedDevice & MixinProvider;
            const { proxy } = await mixinEntry.entry;
            // allow mixins in the process of being released to manage final
            // events, etc, before teardown.
            this.releasing.add(proxy);
            mixinProvider?.releaseMixin(this.id, proxy).catch(() => { });
            await sleep(1000);
            this.releasing.delete(proxy);
        })().catch(() => { });
    }

    async getMixinProviderId(id: string, mixinDevice: any) {
        if (this.releasing.has(mixinDevice))
            return true;
        await this.scrypted.devices[id].handler.ensureProxy();
        for (const mixin of this.scrypted.devices[id].handler.mixinTable) {
            const { proxy } = await mixin.entry;
            if (proxy === mixinDevice) {
                return mixin.mixinProviderId || id;
            }
        }
        return undefined;
    }

    // should this be async?
    invalidate() {
        const mixinTable = this.mixinTable;
        this.mixinTable = undefined;
        for (const mixinEntry of (mixinTable || [])) {
            this.invalidateEntry(mixinEntry);
        }
    }

    /**
     * Rebuild the mixin table with any currently missing mixins.
     */
    rebuildMixinTable() {
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
            console.log('invalidating mixin', this.id, entry.mixinProviderId);
        }

        this.ensureProxy(lastValidMixinId);
    }

    // this must not be async, because it potentially changes execution order.
    ensureProxy(lastValidMixinId?: string): Promise<PluginDevice> {
        const pluginDevice = this.scrypted.findPluginDeviceById(this.id);
        if (!pluginDevice)
            throw new PluginError(`device ${this.id} does not exist`);

        if (!lastValidMixinId) {
            if (this.mixinTable)
                return Promise.resolve(pluginDevice);

            this.mixinTable = [];

            const entry = (async () => {
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
                    console.error('error occurred retrieving device from plugin', e);
                }

                const interfaces: ScryptedInterface[] = getState(pluginDevice, ScryptedInterfaceProperty.providedInterfaces) || [];
                return {
                    passthrough: false,
                    proxy,
                    interfaces: new Set<string>(interfaces),
                    allInterfaces: interfaces,
                }
            })();

            this.mixinTable.unshift({
                mixinProviderId: undefined,
                entry,
            });
        }
        else {
            if (!this.mixinTable)
                throw new PluginError('mixin table partial invalidation was called with empty mixin table');
            const prevTable = this.mixinTable.find(table => table.mixinProviderId === lastValidMixinId);
            if (!prevTable)
                throw new PluginError('mixin table partial invalidation was called with invalid lastValidMixinId');
        }

        for (const mixinId of getState(pluginDevice, ScryptedInterfaceProperty.mixins) || []) {
            if (lastValidMixinId) {
                if (mixinId === lastValidMixinId)
                    lastValidMixinId = undefined;
                continue;
            }

            const wrappedMixinTable = this.mixinTable.slice();
            const entry = this.rebuildEntry(pluginDevice, mixinId, Promise.resolve(wrappedMixinTable));

            this.mixinTable.unshift({
                mixinProviderId: mixinId,
                entry,
            });
        }

        return this.mixinTable[0].entry.then(entry => {
            if (entry.error) {
                console.error('Mixin device creation completed with error. Merging with previous interface set to retain device descriptor.');
                const previousInterfaces = getState(pluginDevice, ScryptedInterfaceProperty.interfaces) as string[] || [];
                const allInterfaces = new Set([...entry.allInterfaces, ...previousInterfaces]);
                entry.allInterfaces = [...allInterfaces];
            }

            const changed = this.scrypted.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.interfaces, PluginDeviceProxyHandler.sortInterfaces(entry.allInterfaces));
            if (changed)
                this.scrypted.notifyPluginDeviceDescriptorChanged(pluginDevice);
            return pluginDevice;
        });
    }

    async rebuildEntry(pluginDevice: PluginDevice, mixinId: string, wrappedMixinTablePromise: Promise<MixinTable[]>): Promise<MixinTableEntry> {
        const wrappedMixinTable = await wrappedMixinTablePromise;
        const previousEntry = wrappedMixinTable[0].entry;

        const type = getDisplayType(pluginDevice);

        let { allInterfaces, error } = await previousEntry;
        try {
            const mixinProvider = this.scrypted.getDevice(mixinId) as ScryptedDevice & MixinProvider;
            const isMixinProvider = mixinProvider?.interfaces?.includes(ScryptedInterface.MixinProvider);
            const interfaces = isMixinProvider && await mixinProvider?.canMixin(type, allInterfaces) as any as ScryptedInterface[];
            if (!interfaces) {
                console.log(`Mixin provider ${mixinId} can no longer mixin ${this.id}.`, {
                    mixinProvider: !!mixinProvider,
                    interfaces,
                });
                if (!error) {
                    if (!mixinProvider || (isMixinProvider && !interfaces)) {
                        const mixins: string[] = getState(pluginDevice, ScryptedInterfaceProperty.mixins) || [];
                        this.scrypted.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.mixins, mixins.filter(mid => mid !== mixinId));
                        this.scrypted.notifyPluginDeviceDescriptorChanged(pluginDevice);
                        this.scrypted.datastore.upsert(pluginDevice);
                    }
                    else {
                        console.log(`Mixin provider ${mixinId} can not mixin ${this.id}. It is no longer a MixinProvider. This may be temporary. Passing through.`);
                    }
                }
                else {
                    console.error(`Error encountered in previous mixin entry may have caused mixin error. Ignoring.`);
                }
                // this is not an error
                // do not advertise interfaces so it is skipped during
                // vtable lookup.
                return {
                    error,
                    passthrough: true,
                    allInterfaces,
                    interfaces: new Set<string>(),
                    proxy: undefined as any,
                };
            }

            const previousInterfaces = allInterfaces;
            allInterfaces = previousInterfaces.slice();
            allInterfaces.push(...interfaces);
            const combinedInterfaces = [...new Set(allInterfaces)];

            const wrappedHandler = new PluginDeviceProxyHandler(this.scrypted, this.id);
            wrappedHandler.mixinTable = wrappedMixinTable;
            const wrappedProxy = new Proxy(wrappedHandler, wrappedHandler);

            const implementer = await (mixinProvider as any)[QueryInterfaceSymbol](ScryptedInterface.MixinProvider);
            const host = this.scrypted.getPluginHostForDeviceId(implementer);
            const propertyInterfaces = getPropertyInterfaces(host.api.descriptors || ScryptedInterfaceDescriptors);
            // todo: remove this and pass the setter directly.
            const deviceState = await host.remote.createDeviceState(this.id,
                async (property, value) => this.scrypted.stateManager.setPluginDeviceStateFromMixin(pluginDevice, property, value, propertyInterfaces[property], mixinId));
            const mixinProxy = await mixinProvider.getMixin(wrappedProxy, previousInterfaces as ScryptedInterface[], deviceState);
            if (!mixinProxy)
                throw new PluginError(`mixin provider ${mixinId} did not return mixin for ${this.id}`);

            // mixin is a passthrough of no interfaces changed, and the proxy is the same
            // a mixin can be a passthrough even if it implements an interface (like Settings),
            // so long as the wrapped proxy also implements that interface.
            // techically it is a passthrough if the proxies are the same instance, but
            // better to be explicit here about interface differences.
            const passthrough = wrappedProxy === mixinProxy && previousInterfaces.length === combinedInterfaces.length;

            return {
                error,
                passthrough,
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
            console.error('Mixin error', e);
            return {
                passthrough: false,
                allInterfaces,
                interfaces: new Set<string>(),
                error: e,
                proxy: undefined as any,
            };
        }
    }

    get(target: any, p: PropertyKey, receiver: any): any {
        if (RpcPeer.PROBED_PROPERTIES.has(p))
            return;
        const handled = RpcPeer.handleFunctionInvocations(this, target, p, receiver);
        if (handled)
            return handled;
        const pluginDevice = this.scrypted.findPluginDeviceById(this.id);
        // device may be deleted.
        if (!pluginDevice)
            return;
        const prop = p.toString();

        if (allInterfaceProperties.includes(prop))
            return getState(pluginDevice, prop);

        if (p === RefreshSymbol || p === QueryInterfaceSymbol)
            return new Proxy(() => p, this);

        if (ScryptedInterfaceDescriptors[ScryptedInterface.ScryptedDevice].methods.includes(prop))
            return (this as any)[p].bind(this);

        return new Proxy(() => prop, this);
    }

    listen(event: string | EventListenerOptions, callback: EventListener): EventListenerRegister {
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
    async setMixins(mixins: string[]): Promise<void> {

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
        const found = await this.findMethod(method);
        if (found) {
            const { mixin, entry } = found;
            const { proxy } = entry;
            if (!proxy) {
                const pluginDevice = this.scrypted.findPluginDeviceById(this.id);
                const name = pluginDevice ? 'Unknown Device' : getState(pluginDevice, ScryptedInterfaceProperty.name);
                throw new PluginError(`device "${name}" is unavailable [id: ${this.id}] [mixin: ${mixin.mixinProviderId}]`);
            }
            return proxy[method](...argArray);
        }

        throw new PluginError(`${method} not implemented`)
    }

    async findMethod(method: string) {
        for (const mixin of this.mixinTable) {
            const entry = await mixin.entry;
            if (!entry.methods) {
                if (entry.interfaces.size) {
                    const pluginDevice = this.scrypted.findPluginDeviceById(mixin.mixinProviderId || this.id);
                    const plugin = this.scrypted.plugins[pluginDevice.pluginId];
                    let methods = new Set<string>(getInterfaceMethods(ScryptedInterfaceDescriptors, entry.interfaces))
                    if (plugin?.api.descriptors)
                        methods = new Set<string>([...methods, ...getInterfaceMethods(plugin.api.descriptors, entry.interfaces)]);
                    entry.methods = methods;
                }
                else {
                    entry.methods = new Set();
                }
            }
            if (entry.methods.has(method)) {
                return { mixin, entry };
            }
        }
    }

    async findMixin(iface: string) {
        for (const mixin of this.mixinTable) {
            const entry = await mixin.entry;
            const { interfaces } = entry;
            if (interfaces.has(iface)) {
                return { mixin, entry };
            }
        }
    }

    async apply(target: any, thisArg: any, argArray?: any): Promise<any> {
        const method = target();

        const { activeRpcPeer } = RpcPeer;
        const acl: AccessControls = activeRpcPeer?.tags?.acl;
        if (acl?.shouldRejectMethod(this.id, method))
            acl.deny();

        this.ensureProxy();
        const pluginDevice = this.scrypted.findPluginDeviceById(this.id);

        if (method === RefreshSymbol)
            return this.applyMixin('refresh', argArray);

        if (method === QueryInterfaceSymbol) {
            const iface = argArray[0];
            if (iface === ScryptedInterface.ScryptedDevice)
                return this.id;
            const found = await this.findMixin(iface);
            if (found?.entry.interfaces.has(iface)) {
                return found.mixin.mixinProviderId || this.id;
            }

            throw new PluginError(`${iface} not implemented`)
        }

        if (method === 'getReadmeMarkdown') {
            const pluginDevice = this.scrypted.findPluginDeviceById(this.id);
            if (pluginDevice && !pluginDevice.nativeId) {
                const plugin = this.scrypted.plugins[pluginDevice.pluginId];
                if (!plugin.packageJson.scrypted.interfaces.includes(ScryptedInterface.Readme)) {
                    const readmePath = path.join(plugin.unzippedPath, 'README.md');
                    if (fs.existsSync(readmePath)) {
                        try {
                            return fs.readFileSync(readmePath).toString();
                        }
                        catch (e) {
                            return "# Error loading Readme:\n\n" + e;
                        }
                    }
                }
            }
        }

        if (method === 'getPluginJson'
            && getState(pluginDevice, ScryptedInterfaceProperty.providedInterfaces)?.includes(ScryptedInterface.ScryptedPlugin)) {
            return this.scrypted.getPackageJson(pluginDevice.pluginId);
        }

        if (method === 'refresh') {
            const refreshInterface = argArray[0];
            const userInitiated = argArray[1];
            return this.scrypted.stateManager.refresh(this.id, refreshInterface, userInitiated);
        }

        if (method === 'createDevice') {
            const idOrNativeId = await this.applyMixin(method, argArray);
            // TODO: 2/17/2023 deprecate this old code path
            let newDevice = this.scrypted.findPluginDevice(pluginDevice.pluginId, idOrNativeId);
            if (newDevice) {
                console.warn(`${pluginDevice.pluginId} is returning legacy nativeId value from createDevice.`);
                return newDevice._id;
            }
            return idOrNativeId;
        }

        return this.applyMixin(method, argArray);
    }
}
