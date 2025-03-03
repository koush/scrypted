import { Device, DeviceManifest, EndpointAccessControlAllowOrigin, EventDetails, EventListenerOptions, EventListenerRegister, MediaManager, ScryptedDevice, ScryptedInterfaceDescriptor, ScryptedInterfaceProperty, ScryptedNativeId } from '@scrypted/types';
import debounce from 'lodash/debounce';
import { Plugin } from '../db-types';
import { Logger } from '../logger';
import { RpcPeer } from '../rpc';
import { ScryptedRuntime } from '../runtime';
import { getState } from '../state';
import { getPropertyInterfaces } from './descriptor';
import { PluginAPI, PluginAPIManagedListeners } from './plugin-api';
import { PluginHost } from './plugin-host';
import { checkProperty } from './plugin-state-check';

export class PluginHostAPI extends PluginAPIManagedListeners implements PluginAPI {
    pluginId: string;
    typesVersion: string;
    descriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor };
    propertyInterfaces: ReturnType<typeof getPropertyInterfaces>;

    [RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS] = [
        'onMixinEvent',
        'onDeviceEvent',
        'setStorage',
        'setDeviceProperty',
        'requestRestart',
        "setState",
    ];

    restartDebounced = debounce(async () => {
        const plugin = await this.scrypted.datastore.tryGet(Plugin, this.pluginId);
        const host = this.scrypted.plugins[this.pluginId];
        if (!plugin) {
            const logger = await this.getLogger(undefined);
            logger.log('w', 'plugin restart was requested, but plugin was not found. restart cancelled.');
            return;
        }
        if (host?.api !== this) {
            const logger = await this.getLogger(undefined);
            logger.log('w', 'plugin restart was requested, but a different instance was found. restart cancelled.');
            return;
        }
        await this.scrypted.runPlugin(plugin);
    }, 15000);

    constructor(public scrypted: ScryptedRuntime, pluginId: string, public pluginHost: PluginHost, public mediaManager: MediaManager) {
        super();
        this.pluginId = pluginId;
    }

    // do we care about mixin validation here?
    // maybe to prevent/notify errant dangling events?
    async onMixinEvent(id: string, nativeIdOrMixinDevice: ScryptedNativeId | any, eventInterface: string, eventData?: any) {
        // nativeId code path has been deprecated in favor of mixin object 12/10/2021
        const device = this.scrypted.findPluginDeviceById(id);

        if (!nativeIdOrMixinDevice || typeof nativeIdOrMixinDevice === 'string') {
            const nativeId: string = nativeIdOrMixinDevice;
            // todo: deprecate this code path
            const mixinProvider = this.scrypted.findPluginDevice(this.pluginId, nativeId);
            const mixins: string[] = getState(device, ScryptedInterfaceProperty.mixins) || [];
            if (!mixins.includes(mixinProvider._id))
                throw new Error(`${mixinProvider._id} is not a mixin provider for ${id}`);

            this.scrypted.findPluginDevice(this.pluginId, nativeId);
            const tableEntry = this.scrypted.devices[device._id].handler.mixinTable.find(entry => entry.mixinProviderId === mixinProvider._id);
            const { interfaces } = await tableEntry.entry;
            if (!interfaces.has(eventInterface))
                throw new Error(`${mixinProvider._id} does not mixin ${eventInterface} for ${id}`);

            this.scrypted.stateManager.notifyInterfaceEvent(device, eventInterface, eventData);
        }
        else {
            const mixin: object = nativeIdOrMixinDevice;
            let mixinProviderId = await this.scrypted.devices[device._id]?.handler?.getMixinProviderId(id, mixin);
            if (!mixinProviderId)
                throw new Error(`${mixin} does not mixin ${eventInterface} for ${id}`);

            if (mixinProviderId === true)
                mixinProviderId = undefined;
            // this.scrypted.stateManager.notifyInterfaceEvent(device, eventInterface, eventData);
            this.scrypted.stateManager.notifyInterfaceEventFromMixin(device, eventInterface, eventData, mixinProviderId as string);
        }
    }

    async getMediaManager(): Promise<MediaManager> {
        return this.mediaManager;
    }

    async getLogger(nativeId: ScryptedNativeId): Promise<Logger> {
        const device = this.scrypted.findPluginDevice(this.pluginId, nativeId);
        return this.scrypted.getDeviceLogger(device);
    }

    async getComponent(id: string): Promise<any> {
        if (id === 'setAccessControlAllowOrigin') {
            return async (options: EndpointAccessControlAllowOrigin) => {
                const { nativeId, origins } = options;
                const device = this.scrypted.findPluginDevice(this.pluginId, nativeId);
                if (!device)
                    throw new Error(`device not found for plugin id ${this.pluginId} native id ${nativeId}`);
                return this.scrypted.corsControl.setCORS(device._id, origins);
            }
        }
        return this.scrypted.getComponent(id);
    }

    setDeviceProperty(id: string, property: ScryptedInterfaceProperty, value: any): Promise<void> {
        switch (property) {
            case ScryptedInterfaceProperty.room:
            case ScryptedInterfaceProperty.type:
            case ScryptedInterfaceProperty.name:
                const device = this.scrypted.findPluginDeviceById(id);
                this.scrypted.stateManager.setPluginDeviceState(device, property, value);
                this.scrypted.notifyPluginDeviceDescriptorChanged(device);
                return;
            default:
                throw new Error(`Not allowed to set property ${property}`);
        }
    }

    async setState(nativeId: ScryptedNativeId, key: string, value: any) {
        checkProperty(key, value);
        const { pluginId } = this;
        const device = this.scrypted.findPluginDevice(pluginId, nativeId);
        if (!device)
            throw new Error(`device not found for plugin id ${pluginId} native id ${nativeId}`);
        await this.scrypted.stateManager.setPluginDeviceStateFromMixin(device, key, value, this.propertyInterfaces?.[key], device._id);
    }

    async setStorage(nativeId: ScryptedNativeId, storage: { [key: string]: string }) {
        const device = this.scrypted.findPluginDevice(this.pluginId, nativeId)
        device.storage = storage;
        this.scrypted.datastore.upsert(device);
    }

    async onDevicesChanged(deviceManifest: DeviceManifest) {
        const provider = this.scrypted.findPluginDevice(this.pluginId, deviceManifest.providerNativeId);
        const existing = this.scrypted.findPluginDevices(this.pluginId).filter(p => p.state[ScryptedInterfaceProperty.providerId].value === provider._id);
        const newIds = deviceManifest.devices.map(device => device.nativeId);
        const toRemove = existing.filter(e => e.nativeId && !newIds.includes(e.nativeId));

        for (const remove of toRemove) {
            await this.scrypted.removeDevice(remove);
        }

        for (const upsert of deviceManifest.devices) {
            upsert.providerNativeId = deviceManifest.providerNativeId;
            const id = await this.pluginHost.upsertDevice(upsert);
            this.scrypted.getDevice(id)?.probe().catch(() => { });
        }
    }

    async onDeviceDiscovered(device: Device) {
        const id = await this.pluginHost.upsertDevice(device);
        this.scrypted.getDevice(id)?.probe().catch(() => { });
        return id;
    }

    async onDeviceRemoved(nativeId: string) {
        await this.scrypted.removeDevice(this.scrypted.findPluginDevice(this.pluginId, nativeId))
    }

    async onDeviceEvent(nativeId: any, eventInterface: any, eventData?: any) {
        const plugin = this.scrypted.findPluginDevice(this.pluginId, nativeId);
        this.scrypted.stateManager.notifyInterfaceEventFromMixin(plugin, eventInterface, eventData, plugin._id);
    }

    async getDeviceById<T>(id: string): Promise<T & ScryptedDevice> {
        return this.scrypted.getDevice(id);
    }
    async listen(callback: (id: string, eventDetails: EventDetails, eventData: any) => void): Promise<EventListenerRegister> {
        return this.manageListener(this.scrypted.stateManager.listen(callback));
    }
    async listenDevice(id: string, event: string | EventListenerOptions, callback: (eventDetails: EventDetails, eventData: any) => void): Promise<EventListenerRegister> {
        // const device = this.scrypted.findPluginDeviceById(id);
        // if (device) {
        //     const self = this.scrypted.findPluginDevice(this.pluginId);
        //     this.scrypted.getDeviceLogger(self).log('i', `requested listen ${getState(device, ScryptedInterfaceProperty.name)} ${JSON.stringify(event)}`);
        // }
        return this.manageListener(this.scrypted.stateManager.listenDevice(id, event, callback));
    }

    async removeDevice(id: string) {
        return this.scrypted.removeDevice(this.scrypted.findPluginDeviceById(id));
    }

    async requestRestart() {
        const logger = await this.getLogger(undefined);
        logger?.log('i', 'plugin restart was requested');
        return this.restartDebounced();
    }

    async setScryptedInterfaceDescriptors(typesVersion: string, descriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor }): Promise<void> {
        this.typesVersion = typesVersion;
        this.descriptors = descriptors;
        this.propertyInterfaces = getPropertyInterfaces(descriptors);
    }
}