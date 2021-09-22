import { ScryptedDevice, Device, DeviceManifest, EventDetails, EventListenerOptions, EventListenerRegister, ScryptedInterfaceProperty, MediaManager, HttpRequest } from '@scrypted/sdk/types'
import { ScryptedRuntime } from '../runtime';
import { Plugin } from '../db-types';
import { PluginAPI, PluginAPIManagedListeners } from './plugin-api';
import { Logger } from '../logger';
import { getState } from '../state';
import { PluginHost } from './plugin-host';
import debounce from 'lodash/debounce';


export class PluginHostAPI extends PluginAPIManagedListeners implements PluginAPI {
    pluginId: string;

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

    constructor(public scrypted: ScryptedRuntime, plugin: Plugin, public pluginHost: PluginHost) {
        super();
        this.pluginId = plugin._id;
    }

    async onMixinEvent(id: string, nativeId: string, eventInterface: any, eventData?: any) {
        const device = this.scrypted.findPluginDeviceById(id);
        const mixinProvider = this.scrypted.findPluginDevice(this.pluginId, nativeId);
        const mixins: string[] = getState(device, ScryptedInterfaceProperty.mixins) || [];
        if (!mixins.includes(mixinProvider._id))
            throw new Error(`${mixinProvider._id} is not a mixin provider for ${id}`);
        const tableEntry = (await this.scrypted.devices[device._id].handler.mixinTable).find(entry => entry.mixinProviderId === mixinProvider._id);
        if (!tableEntry.interfaces.includes(eventInterface))
            throw new Error(`${mixinProvider._id} does not mixin ${eventInterface} for ${id}`);
        this.scrypted.stateManager.notifyInterfaceEvent(device, eventInterface, eventData);
    }

    getMediaManager(): Promise<MediaManager> {
        return null;
    }

    async deliverPush(endpoint: string, httpRequest: HttpRequest) {
        return this.scrypted.deliverPush(endpoint, httpRequest);
    }

    async getLogger(nativeId: string): Promise<Logger> {
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

    async setState(nativeId: string, key: string, value: any) {
        this.scrypted.stateManager.setPluginState(this.pluginId, nativeId, key, value);
    }

    async setStorage(nativeId: string, storage: { [key: string]: string }) {
        const device = this.scrypted.findPluginDevice(this.pluginId, nativeId)
        device.storage = storage;
        this.scrypted.datastore.upsert(device);
        this.scrypted.stateManager.notifyInterfaceEvent(device, 'Storage', undefined);
    }

    async onDevicesChanged(deviceManifest: DeviceManifest) {
        const existing = this.scrypted.findPluginDevices(this.pluginId);
        const newIds = deviceManifest.devices.map(device => device.nativeId);
        const toRemove = existing.filter(e => e.nativeId && !newIds.includes(e.nativeId));

        for (const remove of toRemove) {
            await this.scrypted.removeDevice(remove);
        }

        for (const upsert of deviceManifest.devices) {
            await this.pluginHost.upsertDevice(upsert);
        }
    }

    async onDeviceDiscovered(device: Device) {
        await this.pluginHost.upsertDevice(device);
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
    async listen(EventListener: (id: string, eventDetails: EventDetails, eventData: object) => void): Promise<EventListenerRegister> {
        return this.manageListener(this.scrypted.stateManager.listen(EventListener));
    }
    async listenDevice(id: string, event: string | EventListenerOptions, callback: (eventDetails: EventDetails, eventData: object) => void): Promise<EventListenerRegister> {
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