import { ScryptedNativeId, ScryptedDevice, Device, DeviceManifest, EventDetails, EventListenerOptions, EventListenerRegister, ScryptedInterfaceProperty, MediaManager, HttpRequest } from '@scrypted/types'
import { ScryptedRuntime } from '../runtime';
import { Plugin } from '../db-types';
import { PluginAPI, PluginAPIManagedListeners } from './plugin-api';
import { Logger } from '../logger';
import { getState } from '../state';
import { PluginHost } from './plugin-host';
import debounce from 'lodash/debounce';
import { PROPERTY_PROXY_ONEWAY_METHODS } from '@scrypted/rpc';

export class PluginHostAPI extends PluginAPIManagedListeners implements PluginAPI {
    pluginId: string;

    [PROPERTY_PROXY_ONEWAY_METHODS] = [
        'onMixinEvent',
        'onDeviceEvent',
        'setStorage',
        'ioSend',
        'ioClose',
        'setDeviceProperty',
        'deliverPush',
        'requestRestart',
        "setState",
    ];

    restartDebounced = debounce(async () => {
        const host = this.scrypted.plugins[this.pluginId];
        const logger = await this.getLogger(undefined);
        if (host.api !== this) {
            logger.log('w', 'plugin restart was requested, but a different instance was found. restart cancelled.');
            return;
        }

        const plugin = await this.scrypted.datastore.tryGet(Plugin, this.pluginId);
        this.scrypted.runPlugin(plugin);
    }, 15000);

    constructor(public scrypted: ScryptedRuntime, pluginId: string, public pluginHost: PluginHost, public mediaManager: MediaManager) {
        super();
        this.pluginId = pluginId;
    }

    // do we care about mixin validation here?
    // maybe to prevent/notify errant dangling events?
    async onMixinEvent(id: string, nativeIdOrMixinDevice: ScryptedNativeId|any, eventInterface: any, eventData?: any) {
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
        }
        else {
            const mixin: object = nativeIdOrMixinDevice;
            if (!await this.scrypted.devices[device._id]?.handler?.isMixin(id, mixin)) {
                throw new Error(`${mixin} does not mixin ${eventInterface} for ${id}`);
            }
        }
        this.scrypted.stateManager.notifyInterfaceEvent(device, eventInterface, eventData);
    }

    async getMediaManager(): Promise<MediaManager> {
        return this.mediaManager;
    }

    async deliverPush(endpoint: string, httpRequest: HttpRequest) {
        return this.scrypted.deliverPush(endpoint, httpRequest);
    }

    async getLogger(nativeId: ScryptedNativeId): Promise<Logger> {
        const device = this.scrypted.findPluginDevice(this.pluginId, nativeId);
        return this.scrypted.getDeviceLogger(device);
    }

    getComponent(id: string): Promise<any> {
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

    async ioClose(id: string) {
        this.pluginHost.io.clients[id]?.close();
        this.pluginHost.ws[id]?.close();
    }

    async ioSend(id: string, message: string) {
        this.pluginHost.io.clients[id]?.send(message);
        this.pluginHost.ws[id]?.send(message);
    }

    async setState(nativeId: ScryptedNativeId, key: string, value: any) {
        this.scrypted.stateManager.setPluginState(this.pluginId, nativeId, key, value);
    }

    async setStorage(nativeId: ScryptedNativeId, storage: { [key: string]: string }) {
        const device = this.scrypted.findPluginDevice(this.pluginId, nativeId)
        device.storage = storage;
        this.scrypted.datastore.upsert(device);
        this.scrypted.stateManager.notifyInterfaceEvent(device, 'Storage', undefined);
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
            await this.pluginHost.upsertDevice(upsert);
        }
    }

    async onDeviceDiscovered(device: Device) {
        return this.pluginHost.upsertDevice(device);
    }

    async onDeviceRemoved(nativeId: string) {
        await this.scrypted.removeDevice(this.scrypted.findPluginDevice(this.pluginId, nativeId))
    }

    async onDeviceEvent(nativeId: any, eventInterface: any, eventData?: any) {
        const plugin = this.scrypted.findPluginDevice(this.pluginId, nativeId);
        this.scrypted.stateManager.notifyInterfaceEvent(plugin, eventInterface, eventData);
    }

    async getDeviceById<T>(id: string): Promise<T & ScryptedDevice> {
        return this.scrypted.getDevice(id);
    }
    async listen(callback: (id: string, eventDetails: EventDetails, eventData: any) => void): Promise<EventListenerRegister> {
        return this.manageListener(this.scrypted.stateManager.listen(callback));
    }
    async listenDevice(id: string, event: string | EventListenerOptions, callback: (eventDetails: EventDetails, eventData: any) => void): Promise<EventListenerRegister> {
        const device = this.scrypted.findPluginDeviceById(id);
        if (device) {
            const self = this.scrypted.findPluginDevice(this.pluginId);
            this.scrypted.getDeviceLogger(self).log('i', `requested listen ${getState(device, ScryptedInterfaceProperty.name)} ${JSON.stringify(event)}`);
        }
        return this.manageListener(this.scrypted.stateManager.listenDevice(id, event, callback));
    }

    async removeDevice(id: string) {
        return this.scrypted.removeDevice(this.scrypted.findPluginDeviceById(id));
    }

    async requestRestart() {
        const logger = await this.getLogger(undefined);
        logger.log('i', 'plugin restart was requested');
        return this.restartDebounced();
    }
}